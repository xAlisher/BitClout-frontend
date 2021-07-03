import { ApplicationRef, ChangeDetectorRef, Component, OnInit, Input, Output, EventEmitter } from "@angular/core";
import { GlobalVarsService } from "../../global-vars.service";
import { BackendApiService, BackendRoutes } from "../../backend-api.service";
import { sprintf } from "sprintf-js";
import { Router, ActivatedRoute, Params } from "@angular/router";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { SwalHelper } from "../../../lib/helpers/swal-helper";
import Swal from "sweetalert2";
import { IdentityService } from "../../identity.service";
import { WyreService } from "../../../lib/services/wyre/wyre";

class Messages {
  static INCORRECT_PASSWORD = `Введенный вами пароль был неправильным.`;
  static INSUFFICIENT_BALANCE = `Ваш баланс недостаточен для проведения транзакции.`;
  static CONNECTION_PROBLEM = `У нас возникли проблемы с обработкой вашей транзакции. Пожалуйста, подождите несколько минут и повторите попытку.`;
  static UNKOWN_PROBLEM = `Возникла странная проблема с транзакцией. Отладочный вывод: %s`;

  static CONFIRM_BUY_bitclout = `Вы готовы обменять %s Bitcoin с комиссией в %s Bitcoin на %s BitClout?`;
  static ZERO_bitclout_ERROR = `Вы должны приобрести ненулевую сумму $CLOUT`;
  static NEGATIVE_bitclout_ERROR = `Вы должны приобрести неотрицательное количество $CLOUT`;
}

@Component({
  selector: "buy-bitclout",
  templateUrl: "./buy-bitclout.component.html",
  styleUrls: ["./buy-bitclout.component.scss"],
})
export class BuyBitcloutComponent implements OnInit {
  appData: GlobalVarsService;

  showHowItWorks = false;
  showAreYouReady = false;
  showPendingTransactions = true;
  waitingOnTxnConfirmation = false;
  queryingBitcoinAPI = false;
  wyreService: WyreService;
  showBuyComplete: boolean = false;

  BuyBitcloutComponent = BuyBitcloutComponent;

  static BUY_WITH_USD = "Купить за USD";
  static BUY_WITH_BTC = "Купить за Bitcoin";

  buyTabs = [BuyBitcloutComponent.BUY_WITH_USD, BuyBitcloutComponent.BUY_WITH_BTC];
  activeTab = BuyBitcloutComponent.BUY_WITH_USD;
  constructor(
    private ref: ChangeDetectorRef,
    private globalVars: GlobalVarsService,
    private backendApi: BackendApiService,
    private identityService: IdentityService,
    private route: ActivatedRoute,
    private router: Router,
    private httpClient: HttpClient
  ) {
    this.appData = globalVars;
    this.route.queryParams.subscribe((params: Params) => {
      if (params.btc) {
        this.activeTab = BuyBitcloutComponent.BUY_WITH_BTC;
        this.router.navigate([], { queryParams: {} });
      }
    });
  }

  btcDepositAddress(): string {
    const pubKey = this.appData.loggedInUser.PublicKeyBase58Check;
    return this.identityService.identityServiceUsers[pubKey]?.btcDepositAddress;
  }

  onBuyMoreBitcloutClicked() {
    this.showBuyComplete = false;
    this._queryBitcoinAPI();
  }

  stepOneTooltip() {
    return (
      "$CLOUT можно приобрести всего за несколько минут с помощью Биткоин через полностью децентрализованный процесс.\n\n" +
      "Чтобы начать, просто отправьте Bitcoin на указанный ниже депозитный адрес. Обратите внимание, что депозит должен появиться в интерфейсе " +
      "в течение тридцати секунд или около того, но иногда, по различным техническим причинам, это может занять до часа " +
      "(хотя это случается крайне редко).\n\n" +
      "Как только вы внесли Биткоин, вы можете обменять его на $CLOUT на втором шаге ниже. Если это ваш первый " +
      "раз, мы рекомендуем начать с небольшой тестовой суммы Биткоина, чтобы освоиться с интерфейсом.\n\n" +
      "Обратите внимание, что блокчейн BitClout в настоящее время поддерживает только конвертацию Bitcoin в $CLOUT, а не наоборот " + 
      "Это техническое ограничение, связанное с тем, что блокчейн Bitcoin не поддерживает " + 
      "функции, необходимые для полностью децентрализованного атомарного обмена в обратном направлении. При этом $CLOUT может быть " + 
      "отправлен любому человеку мгновенно, а криптовалютные биржи могут в конечном итоге включить его в список для торговли так же, как они включают в список Биткоин"
    );
  }

  depositBitcoinTooltip() {
    return "Отправьте Биткоин на этот адрес, чтобы вы могли обменять его на $CLOUT на втором шаге ниже.";
  }

  minDepositTooltip() {
    return (
      "Это минимальная сумма, необходимая для покрытия комиссии " +
      "Биткоина, связанной с вашей покупкой. Мы хотели бы сделать комиссию " +
      "ниже, но если бы мы это сделали, то сеть Биткоин отклонила бы вашу транзакцию."
    );
  }

  withdrawBitcoinTooltip() {
    return (
      "If you send too much Bitcoin to your deposit address and need to get it back, you " +
      "can access the Bitcoin in this address by importing your BitClout seed phrase into most standard Bitcoin wallets " +
      "like Electrum and choosing m/44'/0'/0'/0/0 as your derivation path. This works because your BitClout seed phrase is " +
      "what's used to generate your Bitcoin deposit address."
    );
  }

  balanceUpdateTooltip() {
    return (
      "Обычно, когда вы отправляете Биткоин на адрес депозита, он появляется мгновенно. " +
      "Однако в редких случаях это может занять до часа в зависимости от того, откуда вы его отправляете."
    );
  }

  bitcoinNetworkFeeTooltip() {
    return (
      "Процесс обмена Биткоин на $CLOUT требует публикации транзакции в блокчейне Биткоин. По этой причине мы должны добавить комиссию. Это стимулирует майнеров к обработке транзакции."
    );
  }

  _extractBurnError(err: any): string {
    if (err.error != null && err.error.error != null) {
      // Is it obvious yet that I'm not a frontend gal?
      // TODO: Error handling between BE and FE needs a major redesign.
      let rawError = err.error.error;
      if (rawError.includes("password")) {
        return Messages.INCORRECT_PASSWORD;
      } else if (rawError.includes("not sufficient")) {
        return Messages.INSUFFICIENT_BALANCE;
      } else if (rawError.includes("so high")) {
        return `The amount of Bitcoin you've deposited is too low. Please deposit at least ${(
          (this.buyBitCloutFields.bitcoinTransactionFeeRateSatoshisPerKB * 0.3) /
          1e8
        ).toFixed(4)} Bitcoin.`;
      } else if (rawError.includes("total=0")) {
        return `You must purchase a non-zero amount of BitClout.`;
      } else if (rawError.includes("You must burn at least .0001 Bitcoins")) {
        return `You must exchange at least  ${(
          (this.buyBitCloutFields.bitcoinTransactionFeeRateSatoshisPerKB * 0.3) /
          1e8
        ).toFixed(4)} Bitcoin.`;
      } else {
        return rawError;
      }
    }
    if (err.status != null && err.status != 200) {
      return Messages.CONNECTION_PROBLEM;
    }
    // If we get here we have no idea what went wrong so just return the
    // errorString.
    return sprintf(Messages.UNKOWN_PROBLEM, JSON.stringify(err));
  }

  buyBitCloutFields = {
    bitcloutToBuy: "",
    bitcoinToExchange: "",
    bitcoinTransactionFeeRateSatoshisPerKB: 1000 * 1000,
    bitcoinTotalTransactionFeeSatoshis: "0",
    error: "",
  };

  _updateBitcoinFee(bitcoinToExchange: number): Promise<any> {
    if (this.appData == null || this.appData.loggedInUser == null || this.appData.latestBitcoinAPIResponse == null) {
      SwalHelper.fire({
        target: this.globalVars.getTargetComponentSelector(),
        icon: "error",
        title: `Oops...`,
        html: `Please wait for at least one balance update before hitting this button.`,
        showConfirmButton: true,
        showCancelButton: false,
        focusConfirm: true,
        customClass: {
          confirmButton: "btn btn-light",
          cancelButton: "btn btn-light no",
        },
      });

      return;
    }

    // Update the total fee to account for the extra Bitcoin.
    return this.backendApi
      .ExchangeBitcoin(
        this.appData.localNode,
        this.appData.latestBitcoinAPIResponse,
        this.btcDepositAddress(),
        this.appData.loggedInUser.PublicKeyBase58Check,
        Math.floor(bitcoinToExchange * 1e8),
        Math.floor(this.buyBitCloutFields.bitcoinTransactionFeeRateSatoshisPerKB),
        false
      )
      .toPromise()
      .then(
        (res) => {
          if (res == null || res.FeeSatoshis == null) {
            this.buyBitCloutFields.bitcoinTotalTransactionFeeSatoshis = "0";
            this.buyBitCloutFields.error = Messages.UNKOWN_PROBLEM;
            return null;
          }
          this.buyBitCloutFields.error = "";
          this.buyBitCloutFields.bitcoinTotalTransactionFeeSatoshis = res.FeeSatoshis;
          return res;
        },
        (err) => {
          console.error("Problem updating Bitcoin fee Satoshis Per KB", err);
          this.buyBitCloutFields.bitcoinTotalTransactionFeeSatoshis = "0";
          this.buyBitCloutFields.error = this._extractBurnError(err);
          return null;
        }
      );
  }

  stringify(x: any): any {
    return JSON.stringify(x);
  }

  _numPendingTxns(txnObj) {
    if (txnObj == null) {
      return 0;
    }
    return Object.keys(txnObj).length;
  }

  _clickBuyBitClout() {
    if (this.appData == null || this.appData.loggedInUser == null) {
      return;
    }

    if (this.buyBitCloutFields.bitcloutToBuy == "" || parseFloat(this.buyBitCloutFields.bitcloutToBuy) === 0) {
      this.appData._alertError(Messages.ZERO_bitclout_ERROR);
      return;
    }
    if (parseFloat(this.buyBitCloutFields.bitcloutToBuy) < 0) {
      this.appData._alertError(Messages.NEGATIVE_bitclout_ERROR);
      return;
    }

    if (this.buyBitCloutFields.error != null && this.buyBitCloutFields.error !== "") {
      this.appData._alertError(this.buyBitCloutFields.error);
      return;
    }

    let confirmBuyBitCloutString = sprintf(
      Messages.CONFIRM_BUY_bitclout,
      this.buyBitCloutFields.bitcoinToExchange,
      (parseFloat(this.buyBitCloutFields.bitcoinTotalTransactionFeeSatoshis) / 1e8).toFixed(8),
      this.buyBitCloutFields.bitcloutToBuy
    );

    SwalHelper.fire({
      target: this.globalVars.getTargetComponentSelector(),
      title: "Are you ready?",
      html: confirmBuyBitCloutString,
      showCancelButton: true,
      customClass: {
        confirmButton: "btn btn-light",
        cancelButton: "btn btn-light no",
      },
      reverseButtons: true,
    }).then((res: any) => {
      if (res.isConfirmed) {
        // Execute the buy
        this.waitingOnTxnConfirmation = true;
        return this.backendApi
          .ExchangeBitcoin(
            this.appData.localNode,
            this.appData.latestBitcoinAPIResponse,
            this.btcDepositAddress(),
            this.appData.loggedInUser.PublicKeyBase58Check,
            Math.floor(parseFloat(this.buyBitCloutFields.bitcoinToExchange) * 1e8),
            Math.floor(this.buyBitCloutFields.bitcoinTransactionFeeRateSatoshisPerKB),
            true
          )
          .toPromise()
          .then(
            (res) => {
              if (res == null || res.FeeSatoshis == null) {
                this.globalVars.logEvent("bitpop : buy : error");
                this.buyBitCloutFields.bitcoinTotalTransactionFeeSatoshis = "0";
                this.buyBitCloutFields.error = Messages.UNKOWN_PROBLEM;
                return null;
              }
              this.globalVars.logEvent("bitpop : buy", this.buyBitCloutFields);

              // Reset all the form fields and run a BitcoinAPI update
              this.buyBitCloutFields.error = "";
              this.buyBitCloutFields.bitcloutToBuy = "";
              this.buyBitCloutFields.bitcoinToExchange = "";
              this.buyBitCloutFields.bitcoinTotalTransactionFeeSatoshis = "0";
              // Update the BitcoinAPIResponse
              this.appData.latestBitcoinAPIResponse = null;

              // This will update the balance and a bunch of other things.
              this.appData.updateEverything(
                res.BitCloutTxnHashHex,
                this._clickBuyBitCloutSuccess,
                this._clickBuyBitCloutSuccessButTimeout,
                this
              );

              return res;
            },
            (err) => {
              this.globalVars.logEvent("bitpop : buy : error");
              this._clickBuyBitCloutFailure(this, this._extractBurnError(err));
              return null;
            }
          );
      }
    });
  }

  _clickBuyBitCloutSuccess(comp: BuyBitcloutComponent) {
    comp.waitingOnTxnConfirmation = false;
    comp.appData.celebrate();
    comp.showBuyComplete = true;
    comp.ref.detectChanges();
  }

  _clickBuyBitCloutSuccessButTimeout(comp: BuyBitcloutComponent) {
    this.appData.logEvent("bitpop : buy : read-timeout");
    comp.waitingOnTxnConfirmation = false;
    let errString =
      "Your BitClout purchase was successfully broadcast. Due to high load" +
      " your balance may take up to half an hour to show up in your wallet. Please " +
      " check back and hit the 'help' button if you have any problems.";
    comp.appData._alertSuccess(errString);
  }

  _clickBuyBitCloutFailure(comp: BuyBitcloutComponent, errString: string) {
    comp.waitingOnTxnConfirmation = false;
    // The error about "replace by fee" has a link in it, and we want that link
    // to render. There is no risk of injection here.
    if (errString && errString.indexOf("replace by fee") >= 0) {
      // TODO: We should add some kind of htmlSafe attribute or something to
      // do this rather than creating a potentially-insecure if statement as
      // we do here.
      Swal.fire({
        target: this.globalVars.getTargetComponentSelector(),
        icon: "info",
        title: `Almost there!`,
        html: errString,
        showConfirmButton: true,
        focusConfirm: true,
        customClass: {
          confirmButton: "btn btn-light",
          cancelButton: "btn btn-light no",
        },
      });
      return;
    }
    comp.appData._alertError(errString);
  }

  _clickMaxBitClout() {
    this._updateBitcoinFee(-1).then(
      (res) => {
        if (res == null || res.BurnAmountSatoshis == null) {
          return;
        }

        // The fee should have been updated by the time we get here so
        // just update the Bitcoin and BitClout amounts.
        this.buyBitCloutFields.bitcoinToExchange = (res.BurnAmountSatoshis / 1e8).toFixed(8);
        this._updateBitcoinToExchange(this.buyBitCloutFields.bitcoinToExchange);
      },
      (err) => {
        // The error should have been set by the time we get here.
      }
    );
  }

  _computeSatoshisToBurnGivenBitCloutNanos(amountNanos: number) {
    if (!this.appData.satoshisPerBitCloutExchangeRate) {
      SwalHelper.fire({
        target: this.globalVars.getTargetComponentSelector(),
        icon: "error",
        title: `Oops...`,
        html: `We're still fetching some exchange rate data. Try again in about ten seconds.`,
        showConfirmButton: true,
        showCancelButton: false,
        focusConfirm: true,
        customClass: {
          confirmButton: "btn btn-light",
          cancelButton: "btn btn-light no",
        },
      });

      return 0;
    }

    const amountClout = amountNanos / 1e9;

    return (
      amountClout *
      (this.globalVars.satoshisPerBitCloutExchangeRate * (1 + this.globalVars.BuyBitCloutFeeBasisPoints / (100 * 100)))
    );
  }

  _computeNanosToCreateGivenSatoshisToBurn(satoshisToBurn: number): number {
    // Account for the case where we haven't fetched the protocol exchange rate yet.
    // For some reason this was taking 20 seconds in prod...
    if (!this.appData.satoshisPerBitCloutExchangeRate) {
      SwalHelper.fire({
        target: this.globalVars.getTargetComponentSelector(),
        icon: "error",
        title: `Oops...`,
        html: `We're still fetching some exchange rate data. Try again in about ten seconds.`,
        showConfirmButton: true,
        showCancelButton: false,
        focusConfirm: true,
        customClass: {
          confirmButton: "btn btn-light",
          cancelButton: "btn btn-light no",
        },
      });

      return 0;
    }
    return (
      (satoshisToBurn /
        (this.globalVars.satoshisPerBitCloutExchangeRate *
          (1 + this.globalVars.BuyBitCloutFeeBasisPoints / (100 * 100)))) *
      1e9
    );
  }

  _updateBitCloutToBuy(newVal) {
    if (newVal == null || newVal === "") {
      this.buyBitCloutFields.bitcloutToBuy = "";
      this.buyBitCloutFields.bitcoinToExchange = "";
    } else {
      // The .999 factor comes in due to having to consider BitcoinExchangeFeeBasisPoints
      // that goes to pay the miner.
      this.buyBitCloutFields.bitcoinToExchange = (
        this._computeSatoshisToBurnGivenBitCloutNanos(newVal * 1e9) / 1e8
      ).toFixed(8);
    }

    // Update the Bitcoin fee.
    this._updateBitcoinFee(parseFloat(this.buyBitCloutFields.bitcoinToExchange));
  }

  _updateBitcoinToExchange(newVal) {
    if (newVal == null || newVal === "") {
      this.buyBitCloutFields.bitcoinToExchange = "";
      this.buyBitCloutFields.bitcloutToBuy = "";
    } else {
      // Compute the amount of BitClout the user can buy for this amount of Bitcoin and
      // set it.
      //
      // The .999 factor comes in due to having to consider BitcoinExchangeFeeBasisPoints
      // that goes to pay the miner.
      this.buyBitCloutFields.bitcloutToBuy = (
        this._computeNanosToCreateGivenSatoshisToBurn(parseFloat(this.buyBitCloutFields.bitcoinToExchange) * 1e8) / 1e9
      ).toFixed(9);
    }

    // Update the Bitcoin fee.
    this._updateBitcoinFee(parseFloat(this.buyBitCloutFields.bitcoinToExchange));
  }
  _updateSatoshisPerKB() {
    this._updateBitcoinFee(parseFloat(this.buyBitCloutFields.bitcoinToExchange));
  }

  _queryBitcoinAPI() {
    // If we are already querying the bitcoin API, abort mission!
    if (this.queryingBitcoinAPI) {
      return;
    }

    this.appData.latestBitcoinAPIResponse = null;
    this.queryingBitcoinAPI = true;

    this.backendApi.GetBitcoinAPIInfo(this.btcDepositAddress(), this.appData.isTestnet).subscribe(
      (resProm: any) => {
        resProm
          .then((res) => {
            this.appData.latestBitcoinAPIResponse = res;

            this.queryingBitcoinAPI = false;
          })
          .catch(() => {
            this.queryingBitcoinAPI = false;
          });
      },
      (error) => {
        this.queryingBitcoinAPI = false;
        console.error("Error getting BitcoinAPI data: ", error);
      }
    );
  }

  ngOnInit() {
    window.scroll(0, 0);
    this.showAreYouReady =
      this.appData != null && this.appData.loggedInUser != null && this.appData.loggedInUser.BalanceNanos === 0;

    // Query the website to get the fees.
    this.backendApi.GetBitcoinFeeRateSatoshisPerKB().subscribe(
      (res: any) => {
        if (res.priority != null) {
          this.buyBitCloutFields.bitcoinTransactionFeeRateSatoshisPerKB = 2.0 * res.priority * 1000;
          // console.log('Using Bitcoin sats/KB fee: ', this.buyBitCloutFields.bitcoinTransactionFeeRateSatoshisPerKB)
        } else {
          console.error("res.priority was null so didn't set default fee: ", res);
        }
      },
      (error) => {
        console.error("Problem getting Bitcoin fee: ", error);
      }
    );

    this._queryBitcoinAPI();
    // Force an update of the exchange rate when loading the Buy BitClout page to ensure our computations are using the
    // latest rates.
    this.globalVars._updateBitCloutExchangeRate();
  }

  _handleTabClick(tab: string): void {
    this.activeTab = tab;
  }

  _openExchangeSignUp(): void {
    window.open("https://exchange.blockchain.com/trade/signup");
  }
}
