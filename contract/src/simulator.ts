import {
  type CircuitContext,
  type ChargedState,
  type ContractAddress,
  type EncodedZswapLocalState,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress
} from "@midnight-ntwrk/compact-runtime";
import { Contract, type Ledger, ledger, pureCircuits } from "./managed/zero_covenant/contract/index.js";
import { createZeroCovenantPrivateState, witnesses, type ZeroCovenantPrivateState } from "./witnesses.js";

export function toHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromSeedByte(byteVal: number): Uint8Array {
  return new Uint8Array(32).fill(byteVal);
}

/**
 * Stateful Midnight simulator executing the compactc-compiled ZeroCovenant contract
 * across private witness memory and public ledger transitions (Midnight Ledger 9).
 */
export class ZeroCovenantSimulator {
  readonly contract: Contract<ZeroCovenantPrivateState>;
  readonly contractAddress: ContractAddress;
  private contractState: ChargedState;
  private privateState: ZeroCovenantPrivateState;
  private zswapLocalState: EncodedZswapLocalState;

  private constructor(
    contract: Contract<ZeroCovenantPrivateState>,
    contractAddress: ContractAddress,
    contractState: ChargedState,
    privateState: ZeroCovenantPrivateState,
    zswapLocalState: EncodedZswapLocalState
  ) {
    this.contract = contract;
    this.contractAddress = contractAddress;
    this.contractState = contractState;
    this.privateState = privateState;
    this.zswapLocalState = zswapLocalState;
  }

  static async create(opts: {
    deskSecret: Uint8Array;
    initialMinRatioBps?: bigint;
    initialMaxSingleBps?: bigint;
  }): Promise<ZeroCovenantSimulator> {
    const contract = new Contract<ZeroCovenantPrivateState>(witnesses);
    const initPrivate = createZeroCovenantPrivateState({
      deskSecret: opts.deskSecret,
      custodianBalances: [3_000_000n, 3_000_000n, 3_000_000n, 3_000_000n],
      totalLiabilities: 8_000_000n,
      epochSalt: fromSeedByte(0x11)
    });

    const ctorRes = await contract.initialState(
      createConstructorContext(initPrivate, "0".repeat(64)),
      opts.initialMinRatioBps ?? 12_000n,
      opts.initialMaxSingleBps ?? 4_000n
    );

    const ctx = createCircuitContext({
      circuitId: "attestSolvency",
      contractAddress: sampleContractAddress(),
      coinPublicKeyOrZswapState: ctorRes.currentZswapLocalState,
      contractState: ctorRes.currentContractState,
      privateState: ctorRes.currentPrivateState
    });

    return new ZeroCovenantSimulator(
      contract,
      ctx.callContext.contractAddress,
      ctx.callContext.currentQueryContext.state,
      ctorRes.currentPrivateState,
      ctorRes.currentZswapLocalState
    );
  }

  private contextFor(circuitId: string): CircuitContext<ZeroCovenantPrivateState> {
    return createCircuitContext({
      circuitId,
      contractAddress: this.contractAddress,
      coinPublicKeyOrZswapState: this.zswapLocalState,
      contractState: this.contractState,
      privateState: this.privateState
    });
  }

  private applyContext(next: CircuitContext<ZeroCovenantPrivateState>): void {
    this.contractState = next.callContext.currentQueryContext.state;
    if (next.callContext.currentPrivateState) {
      this.privateState = next.callContext.currentPrivateState;
    }
    if (next.callContext.currentZswapLocalState) {
      this.zswapLocalState = next.callContext.currentZswapLocalState;
    }
  }

  getLedger(): Ledger {
    return ledger(this.contractState);
  }

  getPrivateState(): ZeroCovenantPrivateState {
    return this.privateState;
  }

  setPrivateSnapshot(patch: Partial<ZeroCovenantPrivateState>): void {
    this.privateState = { ...this.privateState, ...patch };
  }

  async attestSolvency(): Promise<{ rootHex: string; ledger: Ledger; gasCost: unknown }> {
    const res = await this.contract.impureCircuits.attestSolvency(this.contextFor("attestSolvency"));
    this.applyContext(res.context);
    return {
      rootHex: toHex(res.result),
      ledger: this.getLedger(),
      gasCost: res.gasCost
    };
  }

  async grantAuditorDisclosure(
    auditorPk: Uint8Array,
    targetEpoch: bigint
  ): Promise<{ tagHex: string; grantKeyHex: string; ledger: Ledger }> {
    const res = await this.contract.impureCircuits.grantAuditorDisclosure(
      this.contextFor("grantAuditorDisclosure"),
      auditorPk,
      targetEpoch
    );
    this.applyContext(res.context);
    const grantKey = pureCircuits.computeGrantKey(auditorPk, targetEpoch);
    return {
      tagHex: toHex(res.result),
      grantKeyHex: toHex(grantKey),
      ledger: this.getLedger()
    };
  }

  async tightenCovenantPolicy(newMinRatioBps: bigint, newMaxSingleBps: bigint): Promise<Ledger> {
    const res = await this.contract.impureCircuits.tightenCovenantPolicy(
      this.contextFor("tightenCovenantPolicy"),
      newMinRatioBps,
      newMaxSingleBps
    );
    this.applyContext(res.context);
    return this.getLedger();
  }
}
