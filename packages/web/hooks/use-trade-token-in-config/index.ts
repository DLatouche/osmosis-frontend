import { useState } from "react";
import { AmountConfig } from "@keplr-wallet/hooks";
import { action, computed, makeObservable, observable, override } from "mobx";
import { AppCurrency } from "@keplr-wallet/types";
import { ChainGetter, ObservableQueryBalances } from "@keplr-wallet/stores";
import {
  OptimizedRoutes,
  Pool,
  RoutePathWithAmount,
} from "@osmosis-labs/pools";
import { IFeeConfig } from "@keplr-wallet/hooks/build/tx/types";
import {
  CoinPretty,
  Dec,
  DecUtils,
  Int,
  IntPretty,
  RatePretty,
} from "@keplr-wallet/unit";

export class TradeTokenInConfig extends AmountConfig {
  @observable.ref
  protected _pools: Pool[];

  @observable
  protected _inCurrencyMinimalDenom: string | undefined = undefined;
  @observable
  protected _outCurrencyMinimalDenom: string | undefined = undefined;

  constructor(
    chainGetter: ChainGetter,
    chainId: string,
    sender: string,
    feeConfig: IFeeConfig | undefined,
    queryBalances: ObservableQueryBalances,
    pools: Pool[]
  ) {
    super(chainGetter, chainId, sender, feeConfig, queryBalances);

    this._pools = pools;

    makeObservable(this);
  }

  @action
  setPools(pools: Pool[]) {
    this._pools = pools;
  }

  get pools(): Pool[] {
    return this._pools;
  }

  @override
  setSendCurrency(currency: AppCurrency | undefined) {
    if (currency) {
      this._inCurrencyMinimalDenom = currency.coinMinimalDenom;
    } else {
      this._inCurrencyMinimalDenom = undefined;
    }
  }

  @action
  setOutCurrency(currency: AppCurrency | undefined) {
    if (currency) {
      this._outCurrencyMinimalDenom = currency.coinMinimalDenom;
    } else {
      this._outCurrencyMinimalDenom = undefined;
    }
  }

  @override
  get sendCurrency(): AppCurrency {
    if (this.sendableCurrencies.length === 0) {
      // For the case before pools are initially fetched,
      // it temporarily returns unknown currency rather than handling the case of undefined.
      return {
        coinMinimalDenom: "_unknown",
        coinDenom: "UNKNOWN",
        coinDecimals: 0,
      };
    }

    if (this._inCurrencyMinimalDenom) {
      const currency = this.currencyMap.get(this._inCurrencyMinimalDenom);
      if (currency) {
        return currency;
      }
    }

    return this.sendableCurrencies[0];
  }

  @computed
  get outCurrency(): AppCurrency {
    if (this.sendableCurrencies.length <= 1) {
      // For the case before pools are initially fetched,
      // it temporarily returns unknown currency rather than handling the case of undefined.
      return {
        coinMinimalDenom: "_unknown",
        coinDenom: "UNKNOWN",
        coinDecimals: 0,
      };
    }

    if (this._outCurrencyMinimalDenom) {
      const currency = this.currencyMap.get(this._outCurrencyMinimalDenom);
      if (currency) {
        return currency;
      }
    }

    return this.sendableCurrencies[1];
  }

  @computed
  protected get currencyMap(): Map<string, AppCurrency> {
    return this.sendableCurrencies.reduce<Map<string, AppCurrency>>(
      (previous, current) => {
        previous.set(current.coinMinimalDenom, current);
        return previous;
      },
      new Map()
    );
  }

  @computed
  get sendableCurrencies(): AppCurrency[] {
    if (this.pools.length === 0) {
      return [];
    }

    const chainInfo = this.chainInfo;

    // Get all coin denom in the pools.
    const coinDenomSet = new Set<string>();
    for (const pool of this.pools) {
      for (const poolAssetDenom of pool.poolAssetDenoms) {
        coinDenomSet.add(poolAssetDenom);
      }
    }

    const coinDenoms = Array.from(coinDenomSet);

    const currencyMap = chainInfo.currencies.reduce<Map<string, AppCurrency>>(
      (previous, current) => {
        previous.set(current.coinMinimalDenom, current);
        return previous;
      },
      new Map()
    );

    return coinDenoms
      .filter((coinDenom) => {
        return currencyMap.has(coinDenom);
      })
      .map((coinDenom) => {
        return currencyMap.get(coinDenom)!;
      });
  }

  @action
  switchInAndOut() {
    const outAmount = this.expectedSwapResult.amount;
    if (outAmount.toDec().isZero()) {
      this.setAmount("");
    } else {
      this.setAmount(
        outAmount
          .shrink(true)
          .maxDecimals(6)
          .trim(true)
          .hideDenom(true)
          .toString()
      );
    }

    // Since changing in and out affects each other, it is important to use the stored value.
    const prevInCurrency = this.sendCurrency.coinMinimalDenom;
    const prevOutCurrency = this.outCurrency.coinMinimalDenom;

    this._inCurrencyMinimalDenom = prevOutCurrency;
    this._outCurrencyMinimalDenom = prevInCurrency;
  }

  @computed
  protected get optimizedRoutes(): OptimizedRoutes {
    return new OptimizedRoutes(this.pools);
  }

  @computed
  get optimizedRoutePaths(): RoutePathWithAmount[] {
    const amount = this.getAmountPrimitive();
    if (
      !amount.amount ||
      new Int(amount.amount).lte(new Int(0)) ||
      amount.denom === "_unknown" ||
      this.outCurrency.coinMinimalDenom === "_unknown"
    ) {
      return [];
    }

    return this.optimizedRoutes.getOptimizedRoutesByTokenIn(
      {
        denom: amount.denom,
        amount: new Int(amount.amount),
      },
      this.outCurrency.coinMinimalDenom,
      5
    );
  }

  @computed
  get expectedSwapResult(): {
    amount: CoinPretty;
    beforeSpotPriceWithoutSwapFeeInOverOut: IntPretty;
    beforeSpotPriceWithoutSwapFeeOutOverIn: IntPretty;
    beforeSpotPriceInOverOut: IntPretty;
    beforeSpotPriceOutOverIn: IntPretty;
    afterSpotPriceInOverOut: IntPretty;
    afterSpotPriceOutOverIn: IntPretty;
    effectivePriceInOverOut: IntPretty;
    effectivePriceOutOverIn: IntPretty;
    swapFee: RatePretty;
    slippage: RatePretty;
  } {
    const paths = this.optimizedRoutePaths;
    if (paths.length === 0) {
      return {
        amount: new CoinPretty(this.outCurrency, new Dec(0)),
        beforeSpotPriceWithoutSwapFeeInOverOut: new IntPretty(0),
        beforeSpotPriceWithoutSwapFeeOutOverIn: new IntPretty(0),
        beforeSpotPriceInOverOut: new IntPretty(0),
        beforeSpotPriceOutOverIn: new IntPretty(0),
        afterSpotPriceInOverOut: new IntPretty(0),
        afterSpotPriceOutOverIn: new IntPretty(0),
        effectivePriceInOverOut: new IntPretty(0),
        effectivePriceOutOverIn: new IntPretty(0),
        swapFee: new RatePretty(0),
        slippage: new RatePretty(0),
      };
    }

    const multiplicationInOverOut = DecUtils.getTenExponentN(
      this.outCurrency.coinDecimals - this.sendCurrency.coinDecimals
    );

    const result = this.optimizedRoutes.calculateTokenOutByTokenIn(paths);

    const beforeSpotPriceWithoutSwapFeeInOverOutDec =
      result.beforeSpotPriceInOverOut.mulTruncate(
        new Dec(1).sub(result.swapFee)
      );

    return {
      amount: new CoinPretty(this.outCurrency, result.amount),
      beforeSpotPriceWithoutSwapFeeInOverOut: new IntPretty(
        beforeSpotPriceWithoutSwapFeeInOverOutDec.mulTruncate(
          multiplicationInOverOut
        )
      ),
      beforeSpotPriceWithoutSwapFeeOutOverIn: new IntPretty(
        new Dec(1)
          .quoTruncate(beforeSpotPriceWithoutSwapFeeInOverOutDec)
          .quoTruncate(multiplicationInOverOut)
      ),
      beforeSpotPriceInOverOut: new IntPretty(
        result.beforeSpotPriceInOverOut.mulTruncate(multiplicationInOverOut)
      ),
      beforeSpotPriceOutOverIn: new IntPretty(
        result.beforeSpotPriceOutOverIn.quoTruncate(multiplicationInOverOut)
      ),
      afterSpotPriceInOverOut: new IntPretty(
        result.afterSpotPriceInOverOut.mulTruncate(multiplicationInOverOut)
      ),
      afterSpotPriceOutOverIn: new IntPretty(
        result.afterSpotPriceOutOverIn.quoTruncate(multiplicationInOverOut)
      ),
      effectivePriceInOverOut: new IntPretty(
        result.effectivePriceInOverOut.mulTruncate(multiplicationInOverOut)
      ),
      effectivePriceOutOverIn: new IntPretty(
        result.effectivePriceOutOverIn.quoTruncate(multiplicationInOverOut)
      ),
      swapFee: new RatePretty(result.swapFee),
      slippage: new RatePretty(result.slippage),
    };
  }
}

// CONTRACT: Use with `observer`
// If the reference of the pools changes,
// it will be recalculated without memorization for every render.
// Be sure to pass the pools argument by memorizing it.
export const useTradeTokenInConfig = (
  chainGetter: ChainGetter,
  chainId: string,
  sender: string,
  feeConfig: IFeeConfig | undefined,
  queryBalances: ObservableQueryBalances,
  pools: Pool[]
) => {
  const [config] = useState(
    () =>
      new TradeTokenInConfig(
        chainGetter,
        chainId,
        sender,
        feeConfig,
        queryBalances,
        pools
      )
  );
  config.setChain(chainId);
  config.setSender(sender);
  config.setQueryBalances(queryBalances);
  config.setPools(pools);

  return config;
};