const { computeZeroCascade, hash2 } = require("../src/poseidon");
const { buildTreeLevels, getMerklePath } = require("../src/merkleTree");

async function main() {
  console.log("=== Проверка на 5 листах: путь каждого листа должен самостоятельно восстанавливать корень ===");
  const zeros = await computeZeroCascade();

  // 5 произвольных "коммитментов" для проверки алгоритма (не настоящие вклады)
  const leaves = [111n, 222n, 333n, 444n, 555n];
  const treeLevels = await buildTreeLevels(leaves, zeros);
  const realRoot = treeLevels[8][0];

  let allValid = true;
  for (let i = 0; i < leaves.length; i++) {
    const { pathElements, pathIndices, root } = getMerklePath(treeLevels, i, zeros);

    // Пересчитываем корень с нуля, используя ТОЛЬКО путь — так же, как это
    // делает сама схема (MerkleTreeChecker) при проверке доказательства
    let current = leaves[i];
    for (let level = 0; level < 8; level++) {
      if (pathIndices[level] === 0) {
        current = await hash2(current, pathElements[level]);
      } else {
        current = await hash2(pathElements[level], current);
      }
    }

    const valid = current === realRoot && root === realRoot;
    if (!valid) allValid = false;
    console.log(`Лист ${i} (значение ${leaves[i]}): путь восстанавливает правильный корень:`, valid);
  }

  console.log("");
  console.log("ВСЕ ЛИСТЬЯ ПРОШЛИ ПРОВЕРКУ:", allValid);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
