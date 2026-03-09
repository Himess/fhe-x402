// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

/// @title X402PaymentVerifier — On-chain nonce registry for x402 payments
/// @notice Thin contract that records payment nonces for server-side verification.
///         Servers verify ConfidentialTransfer events (from ERC-7984) plus PaymentVerified
///         events (from this contract) to confirm payments.
contract X402PaymentVerifier {
    /// @notice Used nonces for replay prevention
    mapping(bytes32 => bool) public usedNonces;

    /// @notice Emitted when a payment nonce is recorded
    event PaymentVerified(address indexed payer, address indexed server, bytes32 indexed nonce);

    /// @notice Nonce has already been used
    error NonceAlreadyUsed();

    /// @notice Record a payment nonce on-chain for server verification.
    /// @param payer The address that made the payment
    /// @param server The address that receives the payment
    /// @param nonce Unique payment identifier (bytes32)
    function recordPayment(address payer, address server, bytes32 nonce) external {
        if (usedNonces[nonce]) revert NonceAlreadyUsed();
        usedNonces[nonce] = true;
        emit PaymentVerified(payer, server, nonce);
    }
}
