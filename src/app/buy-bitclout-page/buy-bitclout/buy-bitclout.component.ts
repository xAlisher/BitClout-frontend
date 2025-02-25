import { ApplicationRef, ChangeDetectorRef, Component, OnInit, Input, Output, EventEmitter } from "@angular/core";
import { GlobalVarsService } from "../../global-vars.service";
import { BackendApiService, BackendRoutes } from "../../backend-api.service";
import { sprintf } from "sprintf-js";
import { Router, ActivatedRoute, Params } from "@angular/router";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { SwalHelper } from "../../../lib/helpers/swal-helper";
import Swal from "sweetalert2";
import { IdentityService } from "../../identity.service";

class Messages {
  static INCORRECT_PASSWORD = `The password you entered was incorrect.`;
  static INSUFFICIENT_BALANCE = `Your balance is insufficient to process the transaction.`;
  static CONNECTION_PROBLEM = `We had a problem processing your transaction. Please wait a few minutes and try again.`;
  static UNKOWN_PROBLEM = `There was a weird problem with the transaction. Debug output: %s`;

  static CONFIRM_BUY_bitclout = `Are you ready to exchange %s Bitcoin with a fee of %s Bitcoin for %s BitClout?`;
  static ZERO_bitclout_ERROR = `You must purchase a non-zero amount BitClout`;
  static NEGATIVE_bitclout_ERROR = `You must purchase a non-negative amount of BitClout`;
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

  showBuyComplete: boolean = false;

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
      // Block people from purchasing $BitClout until they enter this magic string.
    });
  }

  btcDepositAddress() {
    const pubKey = this.appData.loggedInUser.PublicKeyBase58Check;
    return this.identityService.identityServiceUsers[pubKey]?.btcDepositAddress;
  }

  onBuyMoreBitcloutClicked() {
    this.showBuyComplete = false;
    this._queryBitcoinAPI();
  }

  stepOneTooltip() {
    return (
      "BitClout can be purchased in just a few minutes using Bitcoin through a completely decentralized process.\n\n" +
      "To get started, simply send Bitcoin to your deposit address below. Note that deposits should show up " +
      "within thirty seconds or so but sometimes, for various technical reasons, it can take up to an hour " +
      "(though this should be extremely rare).\n\n" +
      "Once you've deposited Bitcoin, you can swap it for BitClout in step two below. If it's your first " +
      "time doing this, we recommend starting with a small test amount of Bitcoin to get comfortable with the flow.\n\n" +
      "Note that the BitClout blockchain currently only supports conversion of Bitcoin into BitClout, not the other way " +
      "around. This is a technical limitation due to the fact that the Bitcoin blockchain does not support " +
      'the features required for a fully-decentralized "atomic swap" in the reverse direction. This being said, BitClout can be ' +
      "sent to anybody instantly, and crypto exchanges can eventually list it for trading in the same way they list Bitcoin."
    );
  }

  depositBitcoinTooltip() {
    return "Send Bitcoin to this address so that you can swap it for BitClout in step two below.";
  }

  minDepositTooltip() {
    return (
      "This is the minimum amount required to cover the Bitcoin " +
      "network fees associated with your purchase. We would love to make this " +
      "lower, but if we did then the Bitcoin network would reject your transaction."
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
      "Normally, when you send Bitcoin to the deposit address, it will show up instantly. " +
      "However, it can take up to an hour in rare cases depending on where you send it from."
    );
  }

  bitcoinNetworkFeeTooltip() {
    return (
      "The process of exchanging Bitcoin for BitClout requires posting a transaction to " +
      "the Bitcoin blockchain. For this reason, we must add a network fee to " +
      "incentivize miners to process the transaction."
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
      .BurnBitcoin(
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
          .BurnBitcoin(
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
    if (!this.appData.ProtocolUSDCentsPerBitcoinExchangeRate) {
      SwalHelper.fire({
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
      (((1000000 / Math.log(2)) * 50 * 1e8) / this.appData.ProtocolUSDCentsPerBitcoinExchangeRate / 0.999) *
      (Math.pow(2, (this.appData.NanosSold + amountNanos) / 1000000e9) -
        Math.pow(2, this.appData.NanosSold / 1000000e9))
    );
  }

  _computeNanosToCreateGivenSatoshisToBurn(satoshisToBurn: number): number {
    // Account for the case where we haven't fetched the protocol exchange rate yet.
    // For some reason this was taking 20 seconds in prod...
    if (!this.appData.ProtocolUSDCentsPerBitcoinExchangeRate) {
      SwalHelper.fire({
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
    let nanosPerUnit = 1e9;
    let trancheSizeNanos = 1000000000000000;
    let startPriceSatoshisPerBitClout = (50 * 1e8) / this.appData.ProtocolUSDCentsPerBitcoinExchangeRate;
    let nanosComponent = nanosPerUnit / trancheSizeNanos;
    let bitcoinComponent = satoshisToBurn / startPriceSatoshisPerBitClout;
    let finalBitCloutNanos =
      trancheSizeNanos *
      Math.log2(
        nanosComponent * bitcoinComponent * Math.log(2) + Math.pow(2, this.appData.NanosSold / trancheSizeNanos)
      );

    // We allocate 10bps to BitClout miners which is where the .999 comes from.
    return (finalBitCloutNanos - this.appData.NanosSold) * 0.999;
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
  }
}
