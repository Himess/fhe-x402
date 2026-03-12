// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AgentIdentityRegistry
 * @notice ERC-8004 Agent Identity Registry — on-chain identity for AI agents.
 * @dev Agents register with a URI (JSON metadata), get an ID, and can link a wallet.
 */
contract AgentIdentityRegistry {
    struct Agent {
        string uri;
        address owner;
        address wallet;
    }

    uint256 public nextAgentId = 1;
    mapping(uint256 => Agent) public agents;
    mapping(address => uint256) public walletToAgent;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentURI);
    event AgentWalletSet(uint256 indexed agentId, address indexed wallet);
    event AgentURIUpdated(uint256 indexed agentId, string newURI);

    modifier onlyAgentOwner(uint256 agentId) {
        require(agents[agentId].owner == msg.sender, "Not agent owner");
        _;
    }

    /**
     * @notice Register a new agent.
     * @param agentURI JSON metadata URI describing the agent's capabilities.
     * @return agentId The newly assigned agent ID.
     */
    function register(string calldata agentURI) external returns (uint256) {
        require(bytes(agentURI).length > 0, "Empty URI");
        uint256 agentId = nextAgentId++;
        agents[agentId] = Agent({ uri: agentURI, owner: msg.sender, wallet: msg.sender });
        walletToAgent[msg.sender] = agentId;
        emit AgentRegistered(agentId, msg.sender, agentURI);
        return agentId;
    }

    /**
     * @notice Link a wallet address to an agent.
     */
    function setAgentWallet(uint256 agentId, address wallet) external onlyAgentOwner(agentId) {
        require(wallet != address(0), "Zero address");
        // Clear old mapping
        address oldWallet = agents[agentId].wallet;
        if (oldWallet != address(0)) {
            delete walletToAgent[oldWallet];
        }
        agents[agentId].wallet = wallet;
        walletToAgent[wallet] = agentId;
        emit AgentWalletSet(agentId, wallet);
    }

    /**
     * @notice Update agent URI metadata.
     */
    function updateURI(uint256 agentId, string calldata newURI) external onlyAgentOwner(agentId) {
        require(bytes(newURI).length > 0, "Empty URI");
        agents[agentId].uri = newURI;
        emit AgentURIUpdated(agentId, newURI);
    }

    /**
     * @notice Get agent details.
     */
    function getAgent(uint256 agentId) external view returns (string memory uri, address owner, address wallet) {
        Agent storage a = agents[agentId];
        return (a.uri, a.owner, a.wallet);
    }

    /**
     * @notice Look up agent ID by wallet address.
     */
    function agentOf(address wallet) external view returns (uint256) {
        return walletToAgent[wallet];
    }
}
