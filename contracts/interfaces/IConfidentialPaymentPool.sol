// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";

/// @title IConfidentialPaymentPool — FHE x402 payment pool interface
interface IConfidentialPaymentPool {
    // ═══════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════

    event Deposited(address indexed user, uint64 amount);
    event PaymentExecuted(address indexed from, address indexed to, uint64 minPrice, bytes32 nonce);
    event WithdrawRequested(address indexed user);
    event WithdrawFinalized(address indexed user, uint64 amount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    // ═══════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════

    error ZeroAmount();
    error ZeroAddress();
    error NonceAlreadyUsed();
    error WithdrawNotRequested();
    error WithdrawAlreadyRequested();
    error OnlyOwner();

    // ═══════════════════════════════════════
    // CORE FUNCTIONS
    // ═══════════════════════════════════════

    /// @notice Deposit plaintext USDC into the pool, converting to encrypted balance
    function deposit(uint64 amount) external;

    /// @notice Pay an agent with encrypted amount, verified against public minPrice
    function pay(
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof,
        uint64 minPrice,
        bytes32 nonce
    ) external;

    /// @notice Request async decryption of withdraw amount
    function requestWithdraw(
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external;

    /// @notice Finalize withdrawal with KMS decryption proof
    function finalizeWithdraw(
        uint64 clearAmount,
        bytes calldata decryptionProof
    ) external;

    /// @notice Request async decryption of balance
    function requestBalance() external;

    // ═══════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════

    /// @notice Get encrypted balance handle
    function balanceOf(address account) external view returns (euint64);

    /// @notice Check if a nonce has been used
    function usedNonces(bytes32 nonce) external view returns (bool);
}
