# Latheon — Bridge Privacy: Design Document (v0.1, draft)

**Status:** Design exploration, not yet implemented. Does not change any currently deployed contract or the current L1 prototypes (V3/V4), which continue to work exactly as they do today.

## 1. The problem, precisely

A standard bridge burns/locks tokens at L1 address `A` and mints/releases them at L2 address `A` (same address, both sides — this is the default UX virtually every bridge ships with). This transaction is public on L1. If `A` is linkable to a real identity — a KYC'd exchange withdrawal, a previous public transaction, an ENS name — then the L2 address receiving the bridged funds is identity-linked *before* any shielded deposit into Latheon happens.

The consequence: even though a Latheon withdrawal is cryptographically unlinkable from its deposit, the *deposit* itself is now linkable to a real identity via the bridge trail. An observer learns "identity X deposited into Latheon's shielded pool at time T, amount Y" — which is exactly the information Latheon exists to prevent from being learnable.

This is not a flaw in the shielded pool itself — it's a gap at the boundary between L1 and L2, upstream of anything Latheon's own contracts control.

## 2. Three directions, evaluated with real technical depth

### 2.1 Users acquire L2-native funds directly

Instead of bridging from an identified L1 address, a user obtains LTH already on L2 — e.g., a CEX withdrawal directly to an L2 address, or an L2-native DEX swap using ETH that arrived on L2 through an unrelated, unlinked path.

**Why this helps, partially:** a standard bridge transaction is a strong, easily-filterable signal — anyone can query "which addresses used the official Latheon/Arbitrum bridge in the last month" and get a short, high-confidence list. A CEX withdrawal blends into enormous background volume; filtering "who withdrew from Binance to an L2 address" is a much weaker signal, even though the withdrawal is still KYC'd at the exchange.

**Why this doesn't fully solve it:** the identity link still exists one hop upstream (the exchange knows who withdrew what, when). This shifts the problem, it doesn't remove it. It's a real, cheap mitigation users can apply *today*, with zero engineering from us — but it's user behavior guidance, not a protocol-level fix, and it only works if the user actually follows it.

**Verdict:** worth documenting as user guidance (in `THREAT-MODEL.md`), not a substitute for a real design.

### 2.2 Protocol-level liquidity network (aggregate treasury transfers)

This is a real, precedented pattern — the same basic design used by production "liquidity network" bridges (bonder/liquidity-provider models): the protocol itself holds reserves on *both* L1 and L2, and individual users never personally execute a cross-layer bridge transaction.

**How it would work:** a user sends LTH to Latheon's L1-side liquidity contract, specifying *any* L2 address (ideally a fresh one, not their L1 address) as the recipient. Latheon's L2-side contract immediately releases the equivalent amount to that specified address, drawn from its own L2 reserve — no per-user bridge transaction occurs at the time of the user's action. Periodically, the protocol rebalances its own aggregate reserves between L1 and L2 via the official (slow) bridge, at a size and timing not tied 1:1 to any individual user's transfer.

**Why this genuinely helps:** the address-linkage a standard bridge creates (same address both sides) is specifically what's broken here — the user's L1 sending address and L2 receiving address are decoupled at the smart-contract level, and the protocol's own bulk rebalancing transactions provide no per-user timing signal, since they're batched and delayed.

**What this doesn't solve on its own:** the *L1 side* is still a public transaction from address `A` to Latheon's liquidity contract — an observer learns "address A sent funds toward Latheon" even if they can't tell which L2 address received it. This is a real improvement (breaks the specific address-to-address link) but not complete unlinkability of "who's using Latheon" at the L1 boundary.

**Engineering cost:** moderate. Requires the protocol to bootstrap and manage its own L1 and L2 reserves (capital-intensive — money sitting idle as float), plus the operational complexity of a rebalancing process. This is the kind of thing that needs real liquidity, which we don't have yet as a pre-seed, pre-revenue project — worth flagging honestly as a *later*, funded-stage design, not something to build this month.

### 2.3 A genuinely shielded bridge, reusing our existing cryptography

This is architecturally the most interesting direction, because most of the required cryptographic machinery **already exists** in `LatheonShieldedPoolV3` — this isn't a new primitive, it's a new *application* of one we've already built and tested.

**The key insight:** the *deposit* side of our existing L1 shielded pool already functions as a shielded bridge deposit — it locks funds and inserts a commitment into a Merkle tree, with no link to who deposited. What's missing is a way to *withdraw on L2* against that L1 root, instead of only being able to withdraw back on L1.

**Sketch of how this could work:**
1. User deposits into the existing L1 `LatheonShieldedPoolV3` exactly as they do today — no changes to that contract or that flow.
2. The pool's current root needs to become available on L2. Arbitrum (and most L2s) support native L1→L2 message passing — an L1 contract can trigger a call on L2 directly. A small relay contract could push the L1 pool's root to a corresponding contract on L2 each time it changes, or on a timer.
3. A new L2-side contract holds a mirror of the Groth16 verifier and the relayed root(s). A user generates the *same kind* of withdrawal proof they'd use for a normal L1 withdrawal — but submits it to this L2 contract instead, which checks it against the relayed L1 root and releases equivalent LTH on L2 to any address the user specifies.
4. The nullifier needs to be tracked so the same deposit can't be withdrawn on *both* L1 and L2 — either by relaying nullifier state back to L1 (adds latency and another message-passing round trip) or by treating "L1 withdrawal" and "L2 bridge-withdrawal" as two disjoint nullifier sets tied to the same underlying secret, with the user's own responsibility to pick one (simpler, but relies on user discipline rather than protocol enforcement — worth thinking through further before committing to this simplification).

**Why this is exciting:** it reuses ~90% of already-built, already-tested cryptographic infrastructure (the circuit, the Merkle tree logic, the verifier) rather than inventing a new primitive from scratch. The deposit step requires *zero* changes to anything currently deployed.

**Why this is genuinely hard, and shouldn't be underestimated:** cross-layer message passing adds latency (an L1→L2 message isn't instant) and a new trust/liveness dependency (what happens if the relay contract stalls?). The double-spend-across-layers question in step 4 needs real scrutiny before it's safe — this is exactly the kind of subtlety that deserves independent review, not a first-draft decision baked into a live contract.

## 3. Recommendation

None of these three is a full, ready-to-ship answer today. In order of realism *right now*, given our current stage (pre-seed, solo-founder, no L2 deployment live yet):

1. **Document 2.1 as user guidance immediately** — costs nothing, helps today, belongs in `THREAT-MODEL.md`.
2. **Treat 2.3 as the real target design** — it's the direction most aligned with what we've already built and proven, and the one worth spending real engineering time on once we have an actual L2 deployment to build it against (which is what the Arbitrum buildathon work, and eventually a finalized L2 framework choice, will give us).
3. **Table 2.2** — genuinely useful, precedented pattern, but capital-intensive in a way that doesn't fit a pre-seed, pre-liquidity project. Revisit once there's real treasury to work with.

## 4. What this document does NOT do

It does not commit to a timeline, does not change any deployed contract, and does not claim this is solved. This is the first real pass at structuring the problem — not the final word.
