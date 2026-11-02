# StudyStake contracts (Phase 1)

Foundry project for the StudyStake smart contracts: `StudyStakeManager`, `StudyBadge` (soulbound ERC-721 with ERC-5192), and test mocks (`TestUSDC`, `MockYieldVault`). Spec: `../docs/CONTRACTS.md`.

Solidity 0.8.28, EVM `cancun`, OpenZeppelin Contracts v5.

## Install

1. Install Foundry (Windows: use WSL or Git Bash with `foundryup`, or the Windows installer from getfoundry.sh):
   ```sh
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```
2. From this `contracts/` folder, install the libraries into `lib/`:
   ```sh
   forge install foundry-rs/forge-std --no-commit
   forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-commit
   ```
   The remappings in `foundry.toml` expect `lib/forge-std` and `lib/openzeppelin-contracts`.
3. Copy `.env.example` to `.env` and fill in the values. Do not commit `.env`.

## Build and test

```sh
forge build
forge test -vvv
forge test --match-contract StudyStakeFuzz
forge test --match-path "test/invariant/*"
forge coverage
```

Fuzz runs: 1000 (see `foundry.toml`). Invariant runs: 256, depth 64.

## Deploy

Local (Anvil):
```sh
anvil
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

Avalanche Fuji (chain id 43113):
```sh
forge script script/Deploy.s.sol --rpc-url https://api.avax-test.network/ext/bc/C/rpc --broadcast
```

Addresses are written to `deployments/<chainid>.json`, which the oracle and web app read.

## Notes

- `MockYieldVault` simulates yield with a linear drip. It is for testnet only. Fuji has no live Aave yield.
- `loss_for_testing` exists only on the mock vault, for demos and tests.
- No admin role can withdraw principal. See `../docs/THREAT_MODEL.md` section A.
