// Measurement only: a throwaway single-party setup (no contribution) to time proofs; never use these keys.
// node measure.js <build dir with *.r1cs and *_js/> withdraw_v5 w_a w_b dl
const path=require('path'); const NM=path.resolve(__dirname,'../../../sdk/node_modules')+'/';
const snarkjs=require(NM+'snarkjs'); const {poseidon2,poseidon3}=require(NM+'poseidon-lite');
const P=process.argv[2], PTAU=path.resolve(__dirname,'../../ptau/pot14_final.ptau');
const s=123456789n, v=987654321n, ctx=555n, L=20;
const zeros=(n)=>Array(n).fill('0');
const root=(leaf,tag)=>{let h=leaf;for(let i=0;i<L;i++)h=tag?poseidon3([3n,h,0n]):poseidon2([h,0n]);return h;};
const inputs={
 w_a:()=>{const c=poseidon3([1n,s,v]);return{root:root(c,0),nullifierHash:poseidon3([2n,s,ctx]),ctx,extDataHash:7n,aspRoot:0n,spendKey:s,viewKey:v,pathElements:zeros(L),pathIndices:zeros(L),aspPathElements:zeros(L),aspPathIndices:zeros(L)};},
 w_b:()=>{const c=poseidon3([1n,s,v]);return{root:root(c,1),nullifierHash:poseidon3([2n,s,ctx]),ctx,extDataHash:7n,aspRoot:0n,spendKey:s,viewKey:v,pathElements:zeros(L),pathIndices:zeros(L),aspPathElements:zeros(L),aspPathIndices:zeros(L)};},
 w_d:()=>{const c=poseidon3([1n,s,v]);const r=root(c,1);return{root:r,nullifierHash:poseidon3([2n,s,ctx]),ctx,extDataHash:7n,aspRoot:r,spendKey:s,viewKey:v,pathElements:zeros(L),pathIndices:zeros(L),aspPathElements:zeros(L),aspPathIndices:zeros(L)};},
 dl:()=>({commitment:poseidon3([1n,s,v]),nullifierHash:poseidon3([2n,s,ctx]),ctx,auditorNonce:42n,disclosureTag:poseidon3([5n,v,42n]),spendKey:s,viewKey:v}),
 withdraw_v5:()=>{const c=poseidon2([poseidon2([s,v]),0n]);return{root:root(c,0),nullifierHash:poseidon2([s,1n]),recipient:1n,relayer:0n,fee:0n,spendKey:s,viewKey:v,pathElements:zeros(L),pathIndices:zeros(L)};},
};
(async()=>{const out={};
for (const n of process.argv.slice(3)){
  const zk=`${P}/${n}.zkey`; await snarkjs.zKey.newZKey(`${P}/${n}.r1cs`,PTAU,zk);
  const vk=await snarkjs.zKey.exportVerificationKey(zk); const wasm=`${P}/${n}_js/${n}.wasm`;
  const inp=inputs[n](); const t=[];
  for(let i=0;i<4;i++){const a=Date.now();const {proof,publicSignals}=await snarkjs.groth16.fullProve(inp,wasm,zk);t.push(Date.now()-a);if(i===0&&!(await snarkjs.groth16.verify(vk,publicSignals,proof)))throw new Error('verify failed '+n);}
  t.shift(); t.sort((a,b)=>a-b); out[n]={medianMs:t[1],runs:t,nPublic:vk.nPublic}; console.log(n,JSON.stringify(out[n]));
}
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
