# Privacy simulation

A small, deliberately simple model used to compare design choices for the Latheon distribution pool.
It compares how an observer who sees only note denominations and timing can link withdrawals to deposits.

```
python3 privacy_sim.py
```

Requires Python 3 and NumPy. It is a comparison tool, **not** a proof of privacy: it ignores gas prices, address
reuse, wallet fingerprints and off-chain data. Results and conclusions are in
`docs/distribution-pool-architecture.md` (section 3).
