"""Toy model: how well can an observer link a withdrawal to a deposit, using only note denominations and timing?

This is NOT a proof of privacy and NOT a model of every real attack (it ignores gas prices, address reuse,
wallet fingerprints, off-chain data). It exists to compare design choices for the Latheon distribution pool
under the same, explicit assumptions, and to be re-run by anyone.

Observer sees, for every deposit: its time, its amount and (unless `hidden`) its note composition.
Observer sees, for every withdrawal group (notes paid to one address at one time): the denominations and the time.
Observer guesses uniformly among deposits that could explain the group. Reported number = expected share of
correct guesses (1 / number of candidates). LOWER IS BETTER for privacy.

Run:  python3 privacy_sim.py
"""
import numpy as np

DENOMS = [100, 50, 10, 1]


def greedy(a):
    out = []
    for d in DENOMS:
        out.append(a // d)
        a %= d
    return out


def moderate_random(a, rng):
    """Greedy composition followed by 1-4 random 'breaks' of a larger note into smaller ones."""
    m = greedy(a)
    for _ in range(int(rng.integers(1, 5))):
        opts = [i for i in range(3) if m[i] > 0]
        if not opts:
            break
        i = opts[int(rng.integers(len(opts)))]
        m[i] -= 1
        if i == 0:
            if rng.random() < 0.6:
                m[1] += 2
            else:
                m[2] += 10
        elif i == 1:
            m[2] += 5
        else:
            m[3] += 10
    return m


def amounts(n, kind, rng):
    if kind == 'uniform':
        return rng.integers(10, 1001, n)
    round_amounts = rng.choice([50, 100, 200, 250, 500, 1000], n)  # people like round numbers
    return np.where(rng.random(n) < 0.5, round_amounts, rng.integers(10, 1001, n))


def run(strategy='greedy', behavior='all_at_once', kind='uniform', seed=0, n=1500,
        horizon=30.0, dq=0.0, q=1, hidden=False):
    """dq: queue delay (days, max) before each note becomes withdrawable. q: deposit amounts rounded down to a multiple of q.
    hidden: observer does not learn the note composition at deposit time (only the amount)."""
    rng = np.random.default_rng(seed)
    A = amounts(n, kind, rng)
    A = np.maximum(q, (A // q) * q) if q > 1 else A
    td = rng.uniform(0, horizon, n)
    M = np.array([greedy(int(a)) if strategy == 'greedy' else moderate_random(int(a), rng) for a in A])
    wait_max = 7.0 if behavior == 'all_at_once' else 14.0
    window = wait_max + dq
    succ, csize = [], []
    for i in range(n):
        notes = [j for j in range(4) for _ in range(M[i, j])]
        delays = rng.uniform(0, dq, len(notes)) if dq > 0 else np.zeros(len(notes))
        if behavior == 'all_at_once':
            groups = [(M[i].copy(), td[i] + delays.max() + rng.uniform(0.5, wait_max))]
        else:
            k = min(len(notes), int(rng.integers(2, 5)))
            lab = rng.permutation(len(notes)) % k
            groups = []
            for gi in range(k):
                g = np.zeros(4, int)
                dmax = 0.0
                for idx, l in enumerate(lab):
                    if l == gi:
                        g[notes[idx]] += 1
                        dmax = max(dmax, delays[idx])
                groups.append((g, td[i] + dmax + rng.uniform(0.5, wait_max)))
        for g, tw in groups:
            if g.sum() == 0:
                continue
            mask = (td < tw) & (tw - td <= window)
            total = int((g * np.array(DENOMS)).sum())
            if hidden:
                cand = mask & ((A == total) if behavior == 'all_at_once' else (A >= total))
            else:
                cand = mask & (np.all(M == g, 1) if behavior == 'all_at_once' else np.all(M >= g, 1))
            c = int(cand.sum())
            csize.append(c)
            succ.append(1.0 / c if cand[i] else 0.0)
    return float(np.mean(succ)), float(np.median(csize)), float(M.sum(1).mean())


def avg(seeds=5, **kw):
    r = [run(seed=s, **kw) for s in range(seeds)]
    return np.mean([x[0] for x in r]), np.mean([x[1] for x in r]), np.mean([x[2] for x in r])


if __name__ == '__main__':
    print('TABLE 1 - does the composition matter? (1500 deposits / 30 days, uniform amounts)')
    print(f'{"strategy":<34}{"behaviour":<26}{"attack success":>15}{"notes/deposit":>15}')
    for label, kw in [
        ('greedy, composition visible', dict(strategy='greedy')),
        ('random, composition visible', dict(strategy='random')),
        ('random, composition HIDDEN', dict(strategy='random', hidden=True)),
        ('greedy, composition visible', dict(strategy='greedy', behavior='disciplined')),
        ('random, composition visible', dict(strategy='random', behavior='disciplined')),
    ]:
        s, _, nn = avg(**kw)
        print(f'{label:<34}{kw.get("behavior", "all_at_once"):<26}{s:>14.0%}{nn:>15.1f}')

    print('\nTABLE 2 - what moves the needle? greedy, user withdraws everything at once; attack success')
    print('rows: deposit amounts rounded down to a multiple of q; columns: queue delay before notes become withdrawable')
    for n in (1500, 200):
        print(f'\n  pool activity: {n} deposits / 30 days (~{n / 30:.0f} per day)')
        print(f'  {"q \\ delay":<12}' + ''.join(f'{d:>9}d' for d in (0, 3, 7, 14)))
        for q in (1, 10, 50, 100):
            print(f'  {"q=" + str(q):<12}' + ''.join(f'{avg(n=n, dq=float(d), q=q)[0]:>10.0%}' for d in (0, 3, 7, 14)))
