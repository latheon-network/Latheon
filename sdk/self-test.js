const sdk = require("../src/index");
const { buildTreeLevels, getMerklePath } = require("../src/merkleTree");

async function main() {
  console.log("=== Проверка загрузки всех модулей ===");
  console.log("SEPOLIA.pool:", sdk.SEPOLIA.pool);
  console.log("DENOMINATION:", sdk.DENOMINATION.toString());
  console.log("");

  console.log("=== Проверка Poseidon-функций против известных данных ===");
  const secret = 739738264n;
  const commitment = await sdk.computeCommitment(secret);
  const nullifierHash = await sdk.computeNullifierHash(secret);

  console.log("commitment match:", commitment.toString() === "9795364973993693415770521494914416411979868395478123512127090409899354231800");
  console.log("nullifierHash match:", nullifierHash.toString() === "4483782490019848747383384850249824073443549874533270599652585616863958718917");
  console.log("");

  console.log("=== Проверка полной реконструкции пути в дереве (без сети, вручную заданные депозиты) ===");
  const zeros = await sdk.computeZeroCascade();

  // Симулируем то, что вернул бы fetchDeposits() для нашего реального единственного вклада
  const leaves = [commitment]; // только один лист, индекс 0
  const treeLevels = await buildTreeLevels(leaves, zeros);
  const { pathElements, pathIndices, root } = getMerklePath(treeLevels, 0, zeros);

  console.log("root match:", root.toString() === "14443030408370871341443107951099915878542249841872617351403002133927771695836");
  console.log("pathIndices (должны быть все 0):", pathIndices.join(","));
  console.log("pathElements[0] (должен быть 0):", pathElements[0].toString());
  console.log("pathElements[1] match zeros[1]:", pathElements[1].toString() === zeros[1].toString());

  console.log("");
  console.log("=== Проверка randomFieldElement (без сети — просто структура) ===");
  const { randomFieldElement } = require("../src/pool");
  const r1 = randomFieldElement();
  const r2 = randomFieldElement();
  console.log("два случайных значения разные:", r1 !== r2);
  console.log("значение в пределах поля:", r1 < 21888242871839275222246405745257275088548364400416034343698204186575808495617n);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
