// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IStudyBadge} from "./interfaces/IStudyBadge.sol";

/// @title StudyBadge
/// @notice Soulbound (non-transferable) ERC-721 badge with an on-chain SVG. Implements ERC-5192 (locked).
/// @dev Only accounts holding MANAGER_ROLE (the StudyStakeManager) can record results.
contract StudyBadge is ERC721, AccessControl, IStudyBadge {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    /// @dev ERC-5192 interface id.
    bytes4 private constant ERC5192_INTERFACE_ID = 0xb45a3c0e;

    struct Stats {
        uint32 streak;
        uint32 best_streak;
        uint32 total_completed;
        uint32 total_failed;
        uint64 last_update;
    }

    /// @notice Token id of the badge owned by an account (0 = no badge). Token ids start at 1.
    mapping(address => uint256) public badge_of;
    /// @notice Stats of each badge, keyed by token id.
    mapping(uint256 => Stats) public stats_of;

    uint256 public next_token_id = 1;

    error Soulbound();
    error ZeroAddress();
    error TokenNotFound();

    /// @notice Emitted when a badge is minted (ERC-5192).
    event Locked(uint256 token_id);
    /// @notice Emitted for every recorded challenge result.
    event ResultRecorded(address indexed account, uint256 indexed token_id, bool completed, uint32 streak);

    /// @param admin_ Address granted DEFAULT_ADMIN_ROLE (manages MANAGER_ROLE).
    constructor(address admin_) ERC721("StudyStake Badge", "STUDY") {
        if (admin_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    /// @inheritdoc IStudyBadge
    /// @dev Completed: mints the badge if missing, then streak++ and best_streak = max(best, streak).
    ///      Not completed: resets streak and counts a failure, only if the account already has a badge.
    function record_result(address account, bool completed) external override onlyRole(MANAGER_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        uint256 token_id = badge_of[account];
        uint32 streak_now = 0;

        if (completed) {
            if (token_id == 0) {
                token_id = next_token_id;
                next_token_id = token_id + 1;
                badge_of[account] = token_id;
                _mint(account, token_id);
                emit Locked(token_id);
            }
            Stats storage stats = stats_of[token_id];
            stats.streak += 1;
            if (stats.streak > stats.best_streak) {
                stats.best_streak = stats.streak;
            }
            stats.total_completed += 1;
            stats.last_update = uint64(block.timestamp);
            streak_now = stats.streak;
        } else if (token_id != 0) {
            Stats storage stats_failed = stats_of[token_id];
            stats_failed.streak = 0;
            stats_failed.total_failed += 1;
            stats_failed.last_update = uint64(block.timestamp);
        }

        emit ResultRecorded(account, token_id, completed, streak_now);
    }

    /// @notice ERC-5192: every badge is locked. Reverts if the token does not exist.
    /// @param token_id Badge token id.
    function locked(uint256 token_id) external view returns (bool) {
        _requireOwned(token_id);
        return true;
    }

    /// @notice Returns the badge metadata as a base64 JSON data URI with an embedded SVG image.
    /// @param token_id Badge token id.
    function tokenURI(uint256 token_id) public view override returns (string memory) {
        _requireOwned(token_id);
        Stats memory stats = stats_of[token_id];
        string memory tier = tier_of(stats.best_streak);

        string memory svg = build_svg(stats.streak, tier, tier_color(stats.best_streak));
        string memory image = string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(svg)));

        string memory json = string.concat(
            '{"name":"StudyStake Badge #',
            Strings.toString(token_id),
            '","description":"Soulbound study-commitment badge issued by StudyStake.",',
            '"image":"',
            image,
            '",',
            build_attributes(stats, tier),
            "}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice Soulbound: transfers are only allowed for mint (from == 0) and burn (to == 0).
    function _update(address to, uint256 token_id, address auth) internal override returns (address) {
        address prev_owner = _ownerOf(token_id);
        if (prev_owner != address(0) && to != address(0)) {
            revert Soulbound();
        }
        return super._update(to, token_id, auth);
    }

    /// @notice Soulbound: approvals are disabled.
    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    /// @notice Soulbound: operator approvals are disabled.
    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    /// @inheritdoc ERC721
    function supportsInterface(bytes4 interface_id) public view override(ERC721, AccessControl) returns (bool) {
        return interface_id == ERC5192_INTERFACE_ID || super.supportsInterface(interface_id);
    }

    /// @notice Tier name from the best streak: Gold >= 10, Silver >= 3, otherwise Bronze.
    function tier_of(uint32 best_streak) public pure returns (string memory) {
        if (best_streak >= 10) return "Gold";
        if (best_streak >= 3) return "Silver";
        return "Bronze";
    }

    /// @dev Tier accent color used in the SVG.
    function tier_color(uint32 best_streak) internal pure returns (string memory) {
        if (best_streak >= 10) return "#FFD700";
        if (best_streak >= 3) return "#C0C0C0";
        return "#CD7F32";
    }

    /// @dev Builds the attributes JSON fragment. Contains only numbers and the fixed tier string.
    function build_attributes(Stats memory stats, string memory tier) internal pure returns (string memory) {
        return string.concat(
            '"attributes":[',
            '{"trait_type":"streak","value":',
            Strings.toString(stats.streak),
            "},",
            '{"trait_type":"best_streak","value":',
            Strings.toString(stats.best_streak),
            "},",
            '{"trait_type":"total_completed","value":',
            Strings.toString(stats.total_completed),
            "},",
            '{"trait_type":"tier","value":"',
            tier,
            '"}]'
        );
    }

    /// @dev Builds the SVG image: black background, tier-colored streak number.
    function build_svg(uint32 streak_value, string memory tier, string memory color)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">',
            '<rect width="300" height="300" fill="#000000"/>',
            '<text x="150" y="60" fill="',
            color,
            '" font-family="monospace" font-size="22" text-anchor="middle">STUDYSTAKE</text>',
            '<text x="150" y="200" fill="',
            color,
            '" font-family="sans-serif" font-size="120" font-weight="bold" text-anchor="middle">',
            Strings.toString(streak_value),
            "</text>",
            '<text x="150" y="250" fill="',
            color,
            '" font-family="monospace" font-size="20" text-anchor="middle">',
            tier,
            " STREAK</text>",
            "</svg>"
        );
    }
}
