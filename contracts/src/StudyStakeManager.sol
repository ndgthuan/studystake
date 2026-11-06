// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IStudyBadge} from "./interfaces/IStudyBadge.sol";

/// @title StudyStakeManager
/// @notice No-loss commitment staking. Participants deposit into an ERC-4626 yield vault. Completers share
///         the yield and sponsor bonus pool, and principal is always withdrawable.
/// @dev Admin roles cannot withdraw principal. See docs/THREAT_MODEL.md section A.
contract StudyStakeManager is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    uint256 public constant CLAIM_PERIOD = 180 days;
    uint256 public constant DISPUTE_TIMEOUT = 7 days;
    uint256 public constant MIN_DISPUTE_WINDOW = 5 minutes;
    uint256 public constant MAX_DISPUTE_WINDOW = 7 days;
    uint256 public constant MIN_SETTLE_GRACE = 10 minutes;
    uint256 public constant MAX_SETTLE_GRACE = 14 days;
    /// @notice Gas forwarded to the badge call in claim. Caps what a caller can grief by starving the badge.
    uint256 public constant BADGE_GAS = 300_000;

    enum Status {
        None,
        Open,
        Settled,
        Disputed,
        Finalized,
        Expired
    }

    /// @notice Phase derived from status and time. The UI uses this instead of raw timestamps.
    enum Phase {
        Joining,
        Running,
        AwaitingSettle,
        DisputeWindow,
        Disputed,
        Finalized,
        Expired,
        Expirable,
        Finalizable
    }

    struct Challenge {
        // config
        IERC20 token;
        IERC4626 vault;
        address creator;
        uint128 min_stake;
        uint128 max_stake;
        uint64 join_deadline;
        uint64 end_time;
        uint64 settle_grace;
        uint64 dispute_window;
        bytes32 metadata_hash;
        // live
        Status status;
        uint128 total_principal;
        uint128 total_bonus;
        uint256 total_shares;
        uint32 participant_count;
        // settle
        bytes32 root;
        bytes32 evidence_hash;
        uint64 settled_at;
        uint64 disputed_at;
        uint32 completed_count;
        uint128 completed_stake;
        // finalize / expire
        uint64 finalized_at;
        uint256 final_assets;
        uint128 reward_pot;
        uint128 reward_paid;
        uint128 principal_paid;
        bool loss;
        bool rewards_swept;
        // treasury (yield of a challenge with no completers, collected via collect_treasury)
        uint128 treasury_due;
        bool treasury_collected;
    }

    /// @dev Internal storage. Read through get_challenge(id).
    mapping(uint256 => Challenge) internal challenges;
    mapping(uint256 => mapping(address => uint128)) public stake_of;
    mapping(uint256 => mapping(address => uint64)) public joined_at;
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(uint256 => mapping(address => bool)) public has_disputed;
    mapping(uint256 => mapping(address => uint128)) public sponsor_amount_of;
    mapping(uint256 => mapping(address => bool)) public sponsor_refunded;
    mapping(address => bool) public allowed_token;
    mapping(address => bool) public allowed_vault;

    address public treasury;
    IStudyBadge public immutable badge;
    uint256 public challenge_count;

    error TokenNotAllowed();
    error VaultNotAllowed();
    error VaultAssetMismatch();
    error InvalidParams();
    error WrongStatus();
    error TooEarly();
    error TooLate();
    error AlreadyJoined();
    error StakeOutOfRange();
    error NotParticipant();
    error AlreadyClaimed();
    error AlreadyDisputed();
    error InvalidProof();
    error InvalidSettlement();
    error NothingToRefund();
    error AlreadySwept();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientGas();
    error NothingToCollect();

    event TreasuryUpdated(address new_treasury);
    event TokenAllowed(address token, bool allowed);
    event VaultAllowed(address vault, bool allowed);
    event ChallengeCreated(
        uint256 indexed id,
        address indexed creator,
        address token,
        address vault,
        uint64 join_deadline,
        uint64 end_time,
        bytes32 metadata_hash,
        string metadata_uri
    );
    event Sponsored(uint256 indexed id, address indexed account, uint128 amount);
    event Joined(uint256 indexed id, address indexed account, uint128 amount, uint256 shares, uint64 joined_time);
    event Settled(
        uint256 indexed id, bytes32 root, uint32 completed_count, uint128 completed_stake, bytes32 evidence_hash
    );
    event Disputed(uint256 indexed id, address indexed account, bytes32 reason_hash);
    event DisputeResolved(
        uint256 indexed id, bytes32 root, uint32 completed_count, uint128 completed_stake, bytes32 evidence_hash
    );
    event Finalized(uint256 indexed id, uint256 final_assets, uint256 reward_pot, bool loss);
    event Expired(uint256 indexed id, uint256 final_assets);
    event Claimed(uint256 indexed id, address indexed account, bool completed, uint256 principal_out, uint256 reward);
    event BadgeUpdateFailed(uint256 indexed id, address indexed account);
    event SponsorRefunded(uint256 indexed id, address indexed account, uint256 amount);
    event RewardsSwept(uint256 indexed id, uint256 amount);
    event TreasuryCollected(uint256 indexed id, uint256 amount);

    /// @param admin Receives DEFAULT_ADMIN_ROLE.
    /// @param treasury_ Receives swept rewards, excess yield and expired-without-completion yield.
    /// @param badge_ StudyBadge contract. The manager must hold MANAGER_ROLE on it.
    constructor(address admin, address treasury_, IStudyBadge badge_) {
        if (admin == address(0) || treasury_ == address(0) || address(badge_) == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        treasury = treasury_;
        badge = badge_;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Sets the treasury address. Admin only.
    /// @param new_treasury New treasury address, must be nonzero.
    function set_treasury(address new_treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (new_treasury == address(0)) revert ZeroAddress();
        treasury = new_treasury;
        emit TreasuryUpdated(new_treasury);
    }

    /// @notice Adds or removes a token from the allowlist. Admin only.
    /// @param token Token address, must be nonzero.
    /// @param allowed True to allow.
    function set_allowed_token(address token, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        allowed_token[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    /// @notice Adds or removes a vault from the allowlist. Admin only.
    /// @param vault Vault address, must be nonzero.
    /// @param allowed True to allow.
    function set_allowed_vault(address vault, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (vault == address(0)) revert ZeroAddress();
        allowed_vault[vault] = allowed;
        emit VaultAllowed(vault, allowed);
    }

    /// @notice Pauses create_challenge, join, join_with_permit, sponsor and settle. Guardian only.
    /// @dev Does not block claim, finalize, expire, dispute, resolve_dispute, claim_sponsor_refund or sweep_rewards.
    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    /// @notice Unpauses the contract. Guardian only.
    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Challenge lifecycle
    // ---------------------------------------------------------------------

    /// @notice Creates a new challenge. Creator only, status becomes Open.
    /// @param token Stake token, must be allowlisted.
    /// @param vault ERC-4626 vault, must be allowlisted and have `token` as its asset.
    /// @param min_stake Minimum stake per participant (> 0).
    /// @param max_stake Maximum stake per participant (>= min_stake).
    /// @param join_deadline Last timestamp for joining, must be in the future.
    /// @param end_time Challenge end, must be >= join_deadline.
    /// @param settle_grace Time after end_time during which the oracle may settle.
    /// @param dispute_window Dispute window after settle.
    /// @param metadata_hash Hash of the challenge metadata (course, activities, due dates).
    /// @param metadata_uri URI of the metadata.
    /// @return id The new challenge id, starting from 1.
    function create_challenge(
        IERC20 token,
        IERC4626 vault,
        uint128 min_stake,
        uint128 max_stake,
        uint64 join_deadline,
        uint64 end_time,
        uint64 settle_grace,
        uint64 dispute_window,
        bytes32 metadata_hash,
        string calldata metadata_uri
    ) external onlyRole(CREATOR_ROLE) whenNotPaused nonReentrant returns (uint256 id) {
        _check_tokens(token, vault);
        _check_params(min_stake, max_stake, join_deadline, end_time, settle_grace, dispute_window);

        id = ++challenge_count;
        Challenge storage c = challenges[id];
        c.token = token;
        c.vault = vault;
        c.creator = msg.sender;
        c.min_stake = min_stake;
        c.max_stake = max_stake;
        c.join_deadline = join_deadline;
        c.end_time = end_time;
        c.settle_grace = settle_grace;
        c.dispute_window = dispute_window;
        c.metadata_hash = metadata_hash;
        c.status = Status.Open;
        _emit_created(id, metadata_uri);
    }

    /// @dev Validates token and vault allowlists and the vault asset. Split out to limit stack depth.
    function _check_tokens(IERC20 token, IERC4626 vault) internal view {
        if (!allowed_token[address(token)]) revert TokenNotAllowed();
        if (!allowed_vault[address(vault)]) revert VaultNotAllowed();
        if (vault.asset() != address(token)) revert VaultAssetMismatch();
    }

    /// @dev Validates numeric and time parameters for create_challenge.
    function _check_params(
        uint128 min_stake,
        uint128 max_stake,
        uint64 join_deadline,
        uint64 end_time,
        uint64 settle_grace,
        uint64 dispute_window
    ) internal view {
        if (min_stake == 0 || min_stake > max_stake) revert InvalidParams();
        if (join_deadline <= block.timestamp || end_time < join_deadline) revert InvalidParams();
        if (dispute_window < MIN_DISPUTE_WINDOW || dispute_window > MAX_DISPUTE_WINDOW) revert InvalidParams();
        if (settle_grace < MIN_SETTLE_GRACE || settle_grace > MAX_SETTLE_GRACE) revert InvalidParams();
    }

    /// @dev Emits ChallengeCreated, reading the config back from storage to keep the stack shallow.
    function _emit_created(uint256 id, string calldata metadata_uri) internal {
        Challenge storage c = challenges[id];
        emit ChallengeCreated(
            id,
            c.creator,
            address(c.token),
            address(c.vault),
            c.join_deadline,
            c.end_time,
            c.metadata_hash,
            metadata_uri
        );
    }

    /// @notice Adds bonus (reward pool) tokens to a challenge. Anyone, before end_time. Tokens are held raw.
    /// @param id Challenge id.
    /// @param amount Amount of the stake token, must be > 0.
    function sponsor(uint256 id, uint128 amount) external whenNotPaused nonReentrant {
        Challenge storage c = challenges[id];
        if (c.status != Status.Open) revert WrongStatus();
        if (block.timestamp >= c.end_time) revert TooLate();
        if (amount == 0) revert ZeroAmount();

        c.total_bonus += amount;
        sponsor_amount_of[id][msg.sender] += amount;
        c.token.safeTransferFrom(msg.sender, address(this), amount);
        emit Sponsored(id, msg.sender, amount);
    }

    /// @notice Joins a challenge by depositing `amount` into the vault. One join per address.
    /// @param id Challenge id.
    /// @param amount Stake amount, within [min_stake, max_stake]. Requires prior approval.
    function join(uint256 id, uint128 amount) external whenNotPaused nonReentrant {
        _check_join(id, amount);
        _execute_join(id, amount);
    }

    /// @notice Joins with an EIP-2612 permit in a single transaction.
    /// @dev The permit is wrapped in try/catch. A front-run permit (nonce already used) still lets the join proceed
    ///      if the allowance is already in place.
    /// @param id Challenge id.
    /// @param amount Stake amount, within [min_stake, max_stake].
    /// @param deadline Permit deadline.
    /// @param v Permit signature v.
    /// @param r Permit signature r.
    /// @param s Permit signature s.
    // Read-only reentrancy through view functions only; accepted, see docs/CONTRACTS.md#slither.
    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
    function join_with_permit(uint256 id, uint128 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        whenNotPaused
        nonReentrant
    {
        _check_join(id, amount);
        Challenge storage c = challenges[id];
        try IERC20Permit(address(c.token)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        _execute_join(id, amount);
    }

    /// @notice Submits the Merkle root of completers and the evidence hash. Oracle only, once per challenge.
    /// @param id Challenge id.
    /// @param root Merkle root over completer leaves (zero allowed only if completed_count == 0).
    /// @param completed_count Number of completers, <= participant_count.
    /// @param completed_stake Sum of completers' stakes, <= total_principal.
    /// @param evidence_hash Hash of the public evidence JSON.
    function settle(uint256 id, bytes32 root, uint32 completed_count, uint128 completed_stake, bytes32 evidence_hash)
        external
        onlyRole(ORACLE_ROLE)
        whenNotPaused
        nonReentrant
    {
        Challenge storage c = challenges[id];
        if (c.status != Status.Open) revert WrongStatus();
        if (block.timestamp < c.end_time) revert TooEarly();
        if (block.timestamp >= uint256(c.end_time) + c.settle_grace) revert TooLate();
        _check_settlement(c, root, completed_count, completed_stake);
        _store_settlement(c, root, completed_count, completed_stake, evidence_hash);
        emit Settled(id, root, completed_count, completed_stake, evidence_hash);
    }

    /// @notice Disputes the settlement. Participants only, within dispute_window, once per address.
    /// @param id Challenge id.
    /// @param reason_hash Hash of the dispute reason.
    function dispute(uint256 id, bytes32 reason_hash) external nonReentrant {
        Challenge storage c = challenges[id];
        if (c.status != Status.Settled) revert WrongStatus();
        if (block.timestamp >= uint256(c.settled_at) + c.dispute_window) revert TooLate();
        if (stake_of[id][msg.sender] == 0) revert NotParticipant();
        if (has_disputed[id][msg.sender]) revert AlreadyDisputed();

        has_disputed[id][msg.sender] = true;
        c.status = Status.Disputed;
        c.disputed_at = SafeCast.toUint64(block.timestamp);
        emit Disputed(id, msg.sender, reason_hash);
    }

    /// @notice Replaces the settlement after a dispute. Guardian only, must happen before disputed_at + DISPUTE_TIMEOUT.
    /// @dev Resets settled_at, which reopens the dispute window.
    /// @param id Challenge id.
    /// @param root New Merkle root.
    /// @param completed_count New number of completers.
    /// @param completed_stake New sum of completers' stakes.
    /// @param evidence_hash New evidence hash.
    function resolve_dispute(
        uint256 id,
        bytes32 root,
        uint32 completed_count,
        uint128 completed_stake,
        bytes32 evidence_hash
    ) external onlyRole(GUARDIAN_ROLE) nonReentrant {
        Challenge storage c = challenges[id];
        if (c.status != Status.Disputed) revert WrongStatus();
        if (block.timestamp >= uint256(c.disputed_at) + DISPUTE_TIMEOUT) revert TooLate();
        _check_settlement(c, root, completed_count, completed_stake);
        _store_settlement(c, root, completed_count, completed_stake, evidence_hash);
        emit DisputeResolved(id, root, completed_count, completed_stake, evidence_hash);
    }

    /// @notice Finalizes a settlement. Anyone. Redeems the vault and sets the reward pot.
    /// @dev Allowed from Settled after the dispute window, or from Disputed after DISPUTE_TIMEOUT. A disputed
    ///      challenge finalizes on the settlement currently stored, which is the original one if no resolve_dispute ran.
    ///      Transfers nothing to the treasury. Yield without completers is recorded in treasury_due for collect_treasury.
    /// @param id Challenge id.
    // Read-only reentrancy through view functions only; accepted, see docs/CONTRACTS.md#slither.
    // slither-disable-next-line reentrancy-no-eth
    function finalize(uint256 id) external nonReentrant {
        Challenge storage c = challenges[id];
        Status st = c.status;
        if (st == Status.Settled) {
            if (block.timestamp < uint256(c.settled_at) + c.dispute_window) revert TooEarly();
        } else if (st == Status.Disputed) {
            if (block.timestamp < uint256(c.disputed_at) + DISPUTE_TIMEOUT) revert TooEarly();
        } else {
            revert WrongStatus();
        }

        uint256 assets = _redeem_all(c);
        bool has_loss = assets < c.total_principal;
        uint256 yield_amount = has_loss ? 0 : assets - c.total_principal;

        uint256 pot = 0;
        if (c.completed_stake > 0) {
            pot = yield_amount + c.total_bonus;
        } else {
            c.treasury_due = SafeCast.toUint128(yield_amount);
        }

        c.final_assets = assets;
        c.loss = has_loss;
        c.reward_pot = SafeCast.toUint128(pot);
        c.status = Status.Finalized;
        c.finalized_at = SafeCast.toUint64(block.timestamp);

        emit Finalized(id, assets, pot, has_loss);
    }

    /// @notice Sends the yield of a challenge with no completers to the treasury, once. Anyone. Not blocked by pause.
    /// @dev Separate from finalize so a treasury that cannot receive the token cannot block participants' claims.
    /// @param id Challenge id.
    function collect_treasury(uint256 id) external nonReentrant {
        Challenge storage c = challenges[id];
        if (c.status != Status.Finalized) revert WrongStatus();
        uint128 amount = c.treasury_due;
        if (amount == 0 || c.treasury_collected) revert NothingToCollect();

        c.treasury_collected = true;
        c.token.safeTransfer(treasury, amount);
        emit TreasuryCollected(id, amount);
    }

    /// @notice Expires a challenge the oracle did not settle in time. Anyone. Principal plus pro-rata yield is
    ///         returned, and no rewards are paid. Not applicable to Disputed challenges, which finalize instead.
    /// @param id Challenge id.
    // Read-only reentrancy through view functions only; accepted, see docs/CONTRACTS.md#slither.
    // slither-disable-next-line reentrancy-no-eth
    function expire(uint256 id) external nonReentrant {
        Challenge storage c = challenges[id];
        if (c.status != Status.Open) revert WrongStatus();
        if (block.timestamp < uint256(c.end_time) + c.settle_grace) revert TooEarly();

        uint256 assets = _redeem_all(c);
        c.final_assets = assets;
        c.reward_pot = 0;
        c.status = Status.Expired;
        c.finalized_at = SafeCast.toUint64(block.timestamp);
        emit Expired(id, assets);
    }

    /// @notice Claims principal and, if completed with a valid proof on a Finalized challenge, the reward.
    /// @dev Callable while paused. Does not require the badge contract to succeed. On Finalized, the badge call gets
    ///      BADGE_GAS, and the claim reverts with InsufficientGas if the caller forwards too little gas for it.
    /// @param id Challenge id.
    /// @param completed Whether the caller claims to have completed. A false claim gets principal only.
    /// @param proof Merkle proof of the leaf for (chain, this, id, caller, stake). Ignored when completed is false.
    function claim(uint256 id, bool completed, bytes32[] calldata proof) external nonReentrant {
        Challenge storage c = challenges[id];
        uint128 stake = stake_of[id][msg.sender];
        if (stake == 0) revert NotParticipant();
        if (claimed[id][msg.sender]) revert AlreadyClaimed();
        Status st = c.status;
        if (st != Status.Finalized && st != Status.Expired) revert WrongStatus();

        claimed[id][msg.sender] = true;

        uint256 principal_out = _principal_out(c, stake);
        c.principal_paid += SafeCast.toUint128(principal_out);

        uint256 reward = 0;
        if (st == Status.Finalized && completed) {
            reward = _verify_and_reward(c, id, stake, proof);
        }

        uint256 total_out = principal_out + reward;
        if (total_out > 0) c.token.safeTransfer(msg.sender, total_out);
        emit Claimed(id, msg.sender, completed, principal_out, reward);

        if (st == Status.Finalized) {
            if (gasleft() < BADGE_GAS * 64 / 63 + 20_000) revert InsufficientGas();
            try badge.record_result{gas: BADGE_GAS}(msg.sender, completed) {}
            catch {
                emit BadgeUpdateFailed(id, msg.sender);
            }
        }
    }

    /// @notice Refunds a sponsor's bonus when the challenge expired, or finalized with no completers.
    /// @param id Challenge id.
    function claim_sponsor_refund(uint256 id) external nonReentrant {
        Challenge storage c = challenges[id];
        bool refundable = c.status == Status.Expired || (c.status == Status.Finalized && c.completed_stake == 0);
        if (!refundable) revert WrongStatus();

        uint128 amount = sponsor_amount_of[id][msg.sender];
        if (amount == 0 || sponsor_refunded[id][msg.sender]) revert NothingToRefund();

        sponsor_refunded[id][msg.sender] = true;
        c.token.safeTransfer(msg.sender, amount);
        emit SponsorRefunded(id, msg.sender, amount);
    }

    /// @notice Sends unclaimed rewards to the treasury after CLAIM_PERIOD. Principal is never touched.
    /// @param id Challenge id.
    function sweep_rewards(uint256 id) external nonReentrant {
        Challenge storage c = challenges[id];
        if (c.status != Status.Finalized) revert WrongStatus();
        if (block.timestamp <= uint256(c.finalized_at) + CLAIM_PERIOD) revert TooEarly();
        if (c.rewards_swept) revert AlreadySwept();

        uint128 amount = c.reward_pot - c.reward_paid;
        c.rewards_swept = true;
        if (amount > 0) c.token.safeTransfer(treasury, amount);
        emit RewardsSwept(id, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Returns the full challenge struct.
    /// @param id Challenge id.
    function get_challenge(uint256 id) external view returns (Challenge memory) {
        return challenges[id];
    }

    /// @notice Returns the phase of a challenge derived from status and current time. Reverts if id does not exist.
    /// @param id Challenge id.
    function phase_of(uint256 id) external view returns (Phase) {
        Challenge storage c = challenges[id];
        Status st = c.status;
        if (st == Status.None) revert WrongStatus();
        uint256 t = block.timestamp;

        if (st == Status.Open) {
            if (t < c.join_deadline) return Phase.Joining;
            if (t < c.end_time) return Phase.Running;
            if (t < uint256(c.end_time) + c.settle_grace) return Phase.AwaitingSettle;
            return Phase.Expirable;
        }
        if (st == Status.Settled) {
            if (t < uint256(c.settled_at) + c.dispute_window) return Phase.DisputeWindow;
            return Phase.Finalizable;
        }
        if (st == Status.Disputed) {
            if (t < uint256(c.disputed_at) + DISPUTE_TIMEOUT) return Phase.Disputed;
            return Phase.Finalizable;
        }
        if (st == Status.Finalized) return Phase.Finalized;
        return Phase.Expired;
    }

    /// @notice Previews (principal_out, reward) for a claim. Skips Merkle proof verification, so it is informational only.
    /// @param id Challenge id.
    /// @param account Participant address.
    /// @param completed Whether the participant claims completion.
    function preview_claim(uint256 id, address account, bool completed)
        external
        view
        returns (uint256 principal_out, uint256 reward)
    {
        Challenge storage c = challenges[id];
        uint128 stake = stake_of[id][account];
        if (stake == 0 || claimed[id][account]) return (0, 0);
        if (c.status == Status.Finalized || c.status == Status.Expired) {
            principal_out = _principal_out(c, stake);
            if (completed && c.status == Status.Finalized) {
                reward = _reward_amount(c, stake);
            }
        }
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    /// @dev Checks that a join is allowed. Reverts on failure.
    function _check_join(uint256 id, uint128 amount) internal view {
        Challenge storage c = challenges[id];
        if (c.status != Status.Open) revert WrongStatus();
        if (block.timestamp >= c.join_deadline) revert TooLate();
        if (stake_of[id][msg.sender] != 0) revert AlreadyJoined();
        if (amount < c.min_stake || amount > c.max_stake) revert StakeOutOfRange();
    }

    /// @dev Records the stake, pulls tokens, and deposits into the vault. Assumes _check_join passed.
    // Read-only reentrancy through view functions only; accepted, see docs/CONTRACTS.md#slither.
    // slither-disable-next-line reentrancy-no-eth
    function _execute_join(uint256 id, uint128 amount) internal {
        Challenge storage c = challenges[id];
        uint64 joined_time = SafeCast.toUint64(block.timestamp);

        stake_of[id][msg.sender] = amount;
        joined_at[id][msg.sender] = joined_time;
        c.total_principal += amount;
        c.participant_count += 1;

        c.token.safeTransferFrom(msg.sender, address(this), amount);
        c.token.forceApprove(address(c.vault), amount);
        uint256 shares = c.vault.deposit(amount, address(this));
        if (shares == 0) revert ZeroAmount();
        c.total_shares += shares;

        emit Joined(id, msg.sender, amount, shares, joined_time);
    }

    /// @dev Validates settlement parameters.
    function _check_settlement(Challenge storage c, bytes32 root, uint32 completed_count, uint128 completed_stake)
        internal
        view
    {
        if (completed_count > c.participant_count) revert InvalidSettlement();
        if (completed_stake > c.total_principal) revert InvalidSettlement();
        if ((completed_count == 0) != (completed_stake == 0)) revert InvalidSettlement();
        if (completed_count != 0 && root == bytes32(0)) revert InvalidSettlement();
    }

    /// @dev Writes settlement fields and sets status to Settled (also used by resolve_dispute).
    function _store_settlement(
        Challenge storage c,
        bytes32 root,
        uint32 completed_count,
        uint128 completed_stake,
        bytes32 evidence_hash
    ) internal {
        c.root = root;
        c.completed_count = completed_count;
        c.completed_stake = completed_stake;
        c.evidence_hash = evidence_hash;
        c.settled_at = SafeCast.toUint64(block.timestamp);
        c.status = Status.Settled;
    }

    /// @dev Redeems all vault shares held for the challenge. Returns the assets received.
    function _redeem_all(Challenge storage c) internal returns (uint256 assets) {
        if (c.total_shares == 0) return 0;
        assets = c.vault.redeem(c.total_shares, address(this), address(this));
    }

    /// @dev Principal owed to a participant. Pro-rata after expiry or loss, otherwise the full stake.
    function _principal_out(Challenge storage c, uint128 stake) internal view returns (uint256) {
        if (c.status == Status.Expired || c.loss) {
            return uint256(stake) * c.final_assets / c.total_principal;
        }
        return stake;
    }

    /// @dev Reward owed to a completer, capped by the remaining pot. Never reaches principal.
    function _reward_amount(Challenge storage c, uint128 stake) internal view returns (uint256) {
        if (c.rewards_swept || block.timestamp > uint256(c.finalized_at) + CLAIM_PERIOD) return 0;
        if (c.completed_stake == 0) return 0;
        uint256 share = uint256(c.reward_pot) * stake / c.completed_stake;
        uint256 remaining = uint256(c.reward_pot) - c.reward_paid;
        return share < remaining ? share : remaining;
    }

    /// @dev Verifies the completer's Merkle proof and records the reward as paid. Reverts with InvalidProof.
    function _verify_and_reward(Challenge storage c, uint256 id, uint128 stake, bytes32[] calldata proof)
        internal
        returns (uint256 reward)
    {
        if (!MerkleProof.verifyCalldata(proof, c.root, _leaf(id, msg.sender, stake))) revert InvalidProof();
        reward = _reward_amount(c, stake);
        c.reward_paid += SafeCast.toUint128(reward);
    }

    /// @dev Double-hashed leaf, matching the OpenZeppelin StandardMerkleTree encoding.
    function _leaf(uint256 id, address account, uint128 stake) internal view returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(block.chainid, address(this), id, account, uint256(stake)))));
    }
}
