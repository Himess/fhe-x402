// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IConfidentialUSDC.sol";

/// @title ConfidentialUSDC — FHE x402 Token (V4.0 — ERC-7984 + ERC7984ERC20Wrapper)
/// @notice ERC-7984 confidential USDC token. Wrap USDC → encrypted cUSDC, transfer privately,
///         unwrap back to USDC. Fees charged on wrap and unwrap only (transfers are fee-free).
/// @dev    V4.0: Token-centric rewrite. No pool. Agents hold cUSDC directly.
///         Inherits wrap/unwrap from ERC7984ERC20Wrapper, adds fee layer on top.
///         Parent's _unwrapRequests is private, so we override _unwrap() and finalizeUnwrap()
///         with our own _unwrapRecipients mapping.
contract ConfidentialUSDC is
    ZamaEthereumConfig,
    ERC7984ERC20Wrapper,
    Ownable2Step,
    Pausable,
    ReentrancyGuard,
    IConfidentialUSDC
{
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════

    /// @notice Protocol fee: 10 bps (0.1%)
    uint64 public constant FEE_BPS = 10;
    uint64 public constant BPS = 10_000;
    /// @notice Minimum protocol fee: 0.01 USDC (10_000 micro-USDC)
    uint64 public constant MIN_PROTOCOL_FEE = 10_000;

    // ═══════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════

    /// @notice Fee treasury address
    address public treasury;

    /// @notice Accumulated plaintext fees (USDC) available for withdrawal
    uint256 public accumulatedFees;

    /// @notice Our own unwrap request mapping (parent's _unwrapRequests is private)
    mapping(euint64 => address) private _unwrapRecipients;

    // ═══════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════

    constructor(IERC20 _usdc, address _treasury)
        ERC7984("Confidential USDC", "cUSDC", "")
        ERC7984ERC20Wrapper(_usdc)
        Ownable(msg.sender)
    {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    // ═══════════════════════════════════════
    // WRAP (USDC → cUSDC with fee)
    // ═══════════════════════════════════════

    /// @notice Wrap USDC into encrypted cUSDC. Fee deducted from amount.
    ///         Minimum wrap: MIN_PROTOCOL_FEE + 1 (so net > 0 after fee).
    /// @param to Recipient of the cUSDC
    /// @param amount Amount of USDC (6 decimals) to wrap
    function wrap(address to, uint256 amount) public override nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        // Calculate plaintext fee
        uint64 fee = _calculateFee(uint64(amount));
        uint64 netAmount = uint64(amount) - fee;

        // Transfer full USDC from user
        SafeERC20.safeTransferFrom(underlying(), msg.sender, address(this), amount);

        // Mint net cUSDC to recipient (encrypted)
        _mint(to, FHE.asEuint64(netAmount));

        // Track fee as plaintext USDC held in contract
        accumulatedFees += uint256(fee);
    }

    // ═══════════════════════════════════════
    // UNWRAP (cUSDC → USDC, 2-step async)
    // ═══════════════════════════════════════

    /// @dev Override parent's _unwrap to use our own _unwrapRecipients mapping.
    ///      Parent's _unwrapRequests is private, so we replicate the logic.
    function _unwrap(address from, address to, euint64 amount) internal override whenNotPaused {
        require(to != address(0), ERC7984InvalidReceiver(to));
        require(from == msg.sender || isOperator(from, msg.sender), ERC7984UnauthorizedSpender(from, msg.sender));

        // Burn tokens, get actual burnt amount handle
        euint64 burntAmount = _burn(from, amount);
        FHE.makePubliclyDecryptable(burntAmount);

        assert(_unwrapRecipients[burntAmount] == address(0));
        _unwrapRecipients[burntAmount] = to;

        emit UnwrapRequested(to, burntAmount);
    }

    /// @dev Override parent's finalizeUnwrap to deduct fee from USDC transfer.
    function finalizeUnwrap(
        euint64 burntAmount,
        uint64 burntAmountCleartext,
        bytes calldata decryptionProof
    ) public override nonReentrant {
        address to = _unwrapRecipients[burntAmount];
        require(to != address(0), InvalidUnwrapRequest(burntAmount));
        delete _unwrapRecipients[burntAmount];

        // Verify KMS proof
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint64.unwrap(burntAmount);
        bytes memory cleartexts = abi.encode(burntAmountCleartext);
        FHE.checkSignatures(handles, cleartexts, decryptionProof);

        if (burntAmountCleartext > 0) {
            // Calculate withdrawal fee
            uint64 fee = _calculateFee(burntAmountCleartext);
            uint64 netAmount = burntAmountCleartext - fee;

            // Transfer net USDC to recipient (rate is 1 for USDC)
            if (netAmount > 0) {
                SafeERC20.safeTransfer(underlying(), to, uint256(netAmount) * rate());
            }

            // Track fee
            accumulatedFees += uint256(fee) * rate();
        }

        emit UnwrapFinalized(to, burntAmount, burntAmountCleartext);
    }

    // ═══════════════════════════════════════
    // ADMIN — TREASURY
    // ═══════════════════════════════════════

    /// @notice Update the fee treasury address.
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(old, _treasury);
    }

    /// @notice Withdraw accumulated plaintext USDC fees to treasury.
    function treasuryWithdraw() external nonReentrant {
        if (msg.sender != treasury && msg.sender != owner()) revert OwnableUnauthorizedAccount(msg.sender);
        if (accumulatedFees == 0) revert InsufficientFees();

        uint256 amount = accumulatedFees;
        accumulatedFees = 0;
        SafeERC20.safeTransfer(underlying(), treasury, amount);

        emit TreasuryWithdrawn(treasury, amount);
    }

    // ═══════════════════════════════════════
    // ADMIN — PAUSE
    // ═══════════════════════════════════════

    /// @notice Pause wrap/unwrap operations (emergency stop)
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume operations
    function unpause() external onlyOwner {
        _unpause();
    }

    // ═══════════════════════════════════════
    // ERC-165 OVERRIDE
    // ═══════════════════════════════════════

    /// @dev Override supportsInterface for ERC-7984 + ERC-165
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // ═══════════════════════════════════════
    // INTERNAL
    // ═══════════════════════════════════════

    /// @dev Calculate fee: max(amount * FEE_BPS / BPS, MIN_PROTOCOL_FEE)
    function _calculateFee(uint64 amount) internal pure returns (uint64) {
        uint64 percentageFee = (amount * FEE_BPS) / BPS;
        return percentageFee > MIN_PROTOCOL_FEE ? percentageFee : MIN_PROTOCOL_FEE;
    }
}
