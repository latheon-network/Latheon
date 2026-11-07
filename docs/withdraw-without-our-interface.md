# Withdrawing without our interface

What to do if our demo page, our relayer or anything else we run does not let you withdraw. Written for the Latheon test chain (test LTH, no value); the same reasoning will apply to any future chain only as far as that chain's operators allow, see "What we cannot route around" below.

## What you need

Only your **note** (or your **master key**, which finds all notes made with it). The note holds `spendKey` and `viewKey`; nothing else is needed to build a valid withdrawal proof. Neither the demo, the relayer nor anyone else stores your note.

## What the protocol does not require

- **Our web page.** The pools are plain contracts. A withdrawal is a call to `withdraw(...)` on the pool (or `withdrawMany(...)` on the router) with a Groth16 proof. Any software that builds the proof and sends the call works.
- **Our relayer.** The proof binds the recipient, the relayer address and the fee. A proof made with `relayer = 0` and `fee = 0` can be sent by **any** account, yours or someone else's; the coins still go only to the recipient written into the proof. A proof that names our relayer and a fee can still be sent by anyone, but the fee then goes to our relayer's address; if the relayer refuses, make a new proof with `relayer = 0`, `fee = 0`.

## Three ways, from easiest

1. **Run the page yourself.** The demo is a static page in this repository (`demo/index.html`, with `demo/deployments.json` and `demo/vendor/`). Clone the repository and serve the `demo/` folder with any static web server on your computer; it talks to the chain through your wallet and the chain's RPC, not through our site.
2. **Use the SDK from your own wallet.** `sdk/` (see `sdk/README.md`) builds the same proofs in Node.js:
   ```js
   const sdk = require('./sdk/src/index');
   // a note text from the demo, a pool from deployments.json, a recipient address
   await sdk.withdrawNote(signer, pool, noteText, recipient, { circuit });   // no relayer, no fee
   ```
   The wallet that sends the transaction pays the gas in public. If that wallet is linked to you, the withdrawal is linked to you too; that is the price of not using a relayer.
3. **Let someone else send it.** Make a proof with `relayer = 0`, `fee = 0` (in the SDK: `getProofInputsForCommitment`, `buildWithdrawInput`, `proveWithdraw`) and give the proof (not the note) to anyone willing to send the transaction. They cannot redirect the coins or take a fee, because both are fixed in the proof; they learn the recipient, as any sender does.

## What our relayer refuses today

The relayer refuses requests for technical reasons only: pools or routers not in its deployment file (only V7), a request that fails simulation (invalid proof, spent note, unknown Merkle root, a recipient that refuses the coin), a recipient that is a contract (it could burn the relayer's gas), a fee or relayer address other than "zero with no fee" or "its own address with at least the minimum fee", and per-IP and daily limits. It does not check addresses against any list. It sees the recipient and the client's IP address (`THREAT-MODEL.md` §8.4). If this changes, this document and `THREAT-MODEL.md` will say so before it takes effect.

## What we cannot route around (on the test chain)

The Latheon test chain is run by us alone: one sequencer, one validator, one development key (`THREAT-MODEL.md` §8.4). Its public RPC is ours as well. On this testnet you therefore cannot avoid our infrastructure entirely: if the sequencer refused your transaction, the ways above would not help.

Arbitrum chains have a standard escape from a refusing sequencer: a transaction can be submitted through the chain's delayed inbox on the parent chain (Arbitrum Sepolia) and forced in after the delay period. **We have not tested force inclusion on the Latheon test chain**, so we do not promise it here. A production chain would need it documented and tested, together with the staged control plan in `ROADMAP.md`.

## Wording we use

Not "censorship-resistant": the test chain's sequencer, relayer and validator are ours. What is true: **the protocol does not need our permission; a valid proof can be sent without us**, as long as the chain itself accepts the transaction.
