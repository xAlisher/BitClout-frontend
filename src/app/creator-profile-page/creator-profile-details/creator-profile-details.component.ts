import { ChangeDetectorRef, Component, EventEmitter, OnInit, Output, ViewChild } from "@angular/core";
import { BackendApiService, PostEntryResponse, ProfileEntryResponse } from "../../backend-api.service";
import { GlobalVarsService } from "../../global-vars.service";
import { ActivatedRoute, Router } from "@angular/router";
import { Location } from "@angular/common";
import { SwalHelper } from "../../../lib/helpers/swal-helper";
import { CreatorProfileTopCardComponent } from "../creator-profile-top-card/creator-profile-top-card.component";
import { Title } from "@angular/platform-browser";

@Component({
  selector: "creator-profile-details",
  templateUrl: "./creator-profile-details.component.html",
  styleUrls: ["./creator-profile-details.component.scss"],
})
export class CreatorProfileDetailsComponent {
  @ViewChild(CreatorProfileTopCardComponent, { static: false }) childTopCardComponent;

  static TABS = {
    Посты: "Посты",
    // Leaving this one in so old links will direct to the Coin Purchasers tab.
    "creator-coin": "Авторские монеты",
    "coin-purchasers": "Авторские монеты",
    diamonds: "Diamonds",
  };
  static TABS_LOOKUP = {
    Посты: "Посты",
    "Авторские монеты": "creator-coin",
    Diamonds: "diamonds",
  };
  appData: GlobalVarsService;
  userName: string;
  profile: ProfileEntryResponse;
  activeTab: string;
  loading: boolean;

  // emits the UserUnblocked event
  @Output() userUnblocked = new EventEmitter();

  constructor(
    private globalVars: GlobalVarsService,
    private backendApi: BackendApiService,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private location: Location,
    private titleService: Title
  ) {
    this.route.params.subscribe((params) => {
      this.userName = params.username;
      this._refreshContent();
    });
    this.route.queryParams.subscribe((params) => {
      this.activeTab =
        params.tab && params.tab in CreatorProfileDetailsComponent.TABS
          ? CreatorProfileDetailsComponent.TABS[params.tab]
          : "Посты";
    });
  }

  ngOnInit() {
    this.titleService.setTitle(this.userName + " на RuClout");
  }

  userBlocked() {
    this.childTopCardComponent._unfollowIfBlocked();
  }

  unblockUser() {
    this.unblock();
  }

  unblock() {
    SwalHelper.fire({
      target: this.globalVars.getTargetComponentSelector(),
      title: "Разблокировать",
      html: `Этот пользователь снова появится в вашей ленте и в ваших комЭтот пользователь снова появится в вашей ленте и в ваших темахентариях`,
      showCancelButton: true,
      customClass: {
        confirmButton: "btn btn-light",
        cancelButton: "btn btn-light no",
      },
      reverseButtons: true,
    }).then((response: any) => {
      this.userUnblocked.emit(this.profile.PublicKeyBase58Check);
      if (response.isConfirmed) {
        delete this.globalVars.loggedInUser.BlockedPubKeys[this.profile.PublicKeyBase58Check];
        this.backendApi
          .BlockPublicKey(
            this.globalVars.localNode,
            this.globalVars.loggedInUser.PublicKeyBase58Check,
            this.profile.PublicKeyBase58Check,
            true /* unblock */
          )
          .subscribe(
            () => {
              this.globalVars.logEvent("user : unblock");
            },
            (err) => {
              console.log(err);
              const parsedError = this.backendApi.stringifyError(err);
              this.globalVars.logEvent("user : unblock : error", { parsedError });
              this.globalVars._alertError(parsedError);
            }
          );
      }
    });
  }

  _isLoggedInUserFollowing() {
    if (!this.appData.loggedInUser?.PublicKeysBase58CheckFollowedByUser) {
      return false;
    }

    return this.appData.loggedInUser.PublicKeysBase58CheckFollowedByUser.includes(this.profile.PublicKeyBase58Check);
  }

  blockUser() {
    SwalHelper.fire({
      target: this.globalVars.getTargetComponentSelector(),
      title: "Заблокировать?",
      html: `Это скроет все комментарии этого пользователя к вашим сообщениям, а также скроет их из вашего поля зрения в других темах.`,
      showCancelButton: true,
      customClass: {
        confirmButton: "btn btn-light",
        cancelButton: "btn btn-light no",
      },
      reverseButtons: true,
    }).then((response: any) => {
      if (response.isConfirmed) {
        this.globalVars.loggedInUser.BlockedPubKeys[this.profile.PublicKeyBase58Check] = {};
        Promise.all([
          this.backendApi
            .BlockPublicKey(
              this.globalVars.localNode,
              this.globalVars.loggedInUser.PublicKeyBase58Check,
              this.profile.PublicKeyBase58Check
            )
            .subscribe(
              () => {
                this.globalVars.logEvent("user : block");
              },
              (err) => {
                console.error(err);
                const parsedError = this.backendApi.stringifyError(err);
                this.globalVars.logEvent("user : block : error", { parsedError });
                this.globalVars._alertError(parsedError);
              }
            ),
          // Unfollow this profile if we are currently following it.
          this.childTopCardComponent._unfollowIfBlocked(),
        ]);
      }
    });
  }

  _refreshContent() {
    if (this.loading) {
      return;
    }

    let readerPubKey = "";
    if (this.globalVars.loggedInUser) {
      readerPubKey = this.globalVars.loggedInUser.PublicKeyBase58Check;
    }

    this.loading = true;
    this.backendApi.GetSingleProfile(this.globalVars.localNode, "", this.userName).subscribe(
      (res) => {
        if (!res || res.IsBlacklisted) {
          this.loading = false;
          this.router.navigateByUrl("/" + this.appData.RouteNames.NOT_FOUND, { skipLocationChange: true });
          return;
        }
        this.profile = res.Profile;
        this.loading = false;
      },
      (_) => {
        this.loading = false;
      }
    );
  }

  _handleTabClick(tabName: string) {
    this.activeTab = tabName;
    // Update query params to reflect current tab
    const urlTree = this.router.createUrlTree([], {
      queryParams: { tab: CreatorProfileDetailsComponent.TABS_LOOKUP[tabName] || "Посты" },
      queryParamsHandling: "merge",
      preserveFragment: true,
    });
    this.location.go(urlTree.toString());
  }

  tweetToClaimLink() {
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      `Just setting up my bitclout 💎🙌\n\nhttps://bitclout.com/u/${this.userName}?public_key=${this.globalVars.loggedInUser.PublicKeyBase58Check}`
    )}`;
  }

  showProfileAsReserved() {
    return this.profile.IsReserved && !this.profile.IsVerified;
  }

  isPubKeyBalanceless(): boolean {
    return (
      !this.globalVars.loggedInUser?.ProfileEntryResponse?.Username &&
      this.globalVars.loggedInUser?.UsersYouHODL?.length === 0
    );
  }
}
