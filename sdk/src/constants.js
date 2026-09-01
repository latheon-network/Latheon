// Sepolia testnet deployment. See STATUS.md in the repository root for the
// authoritative, always-current list — update this file if those addresses
// ever change.

const SEPOLIA = {
  chainId: 11155111,
  token: "0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D",
  pool: "0x9d047AdA4e33D28fBd86220f3F899A7Df7e3360C",
  verifier: "0x5E4D51352153513A9085e4e65B8541f393E4D470",
  faucet: "0xF4ab260E65D7c6bEE3D1192d2Cef677199B1f214",
};

const DENOMINATION = 100n * 10n ** 18n; // 100 LTH per deposit
const LEVELS = 8; // must match circuits/withdraw.circom exactly

const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const POOL_ABI = [
  "function deposit(uint256 commitment)",
  "function withdraw(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256[2] _pubSignals, address recipient)",
  "function nextIndex() view returns (uint32)",
  "function currentRootIndex() view returns (uint32)",
  "function roots(uint256) view returns (uint256)",
  "function isKnownRoot(uint256 root) view returns (bool)",
  "function nullifierHashes(uint256) view returns (bool)",
  "event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp)",
  "event Withdrawal(address indexed to, uint256 nullifierHash, uint256 timestamp)",
];

const FAUCET_ABI = [
  "function claim()",
  "function claimsRemaining() view returns (uint256)",
  "function timeUntilNextClaim(address user) view returns (uint256)",
];

module.exports = { SEPOLIA, DENOMINATION, LEVELS, TOKEN_ABI, POOL_ABI, FAUCET_ABI };
