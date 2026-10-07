/**
 * The app's icon set, in one place.
 *
 * The design system draws Phosphor glyphs in two weights: fill for objects,
 * places and actions (house, bell, heart, chat), bold for direction and
 * control marks (carets, arrows, close, check, plus, more). Search is the
 * exception: a plain, regular-weight lens. Call sites name the role they
 * need; this module decides the glyph and its weight, so the icon language
 * stays consistent on every screen.
 *
 * Many exports keep the names the screens were first written with (`PieChart`,
 * `MessageSquare`…). They render the design system's glyph for that role.
 */
import { forwardRef } from "react";
import type { Icon as Glyph, IconProps } from "@phosphor-icons/react";
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowDownRightIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsDownUpIcon,
  ArrowsLeftRightIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  AtIcon,
  BankIcon,
  BasketballIcon,
  BellIcon,
  BellSlashIcon,
  BookmarkSimpleIcon,
  BookOpenIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ChartBarIcon,
  ChartPieSliceIcon,
  ChatCircleIcon,
  CheckCircleIcon,
  CheckIcon,
  ChecksIcon,
  CircleDashedIcon,
  ClockCounterClockwiseIcon,
  ClockIcon,
  CloudLightningIcon,
  CompassIcon,
  CopySimpleIcon,
  CpuIcon,
  CurrencyBtcIcon,
  DotsSixVerticalIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  ExportIcon,
  EyeIcon,
  EyeSlashIcon,
  FilmSlateIcon,
  FlagIcon,
  FlaskIcon,
  FunnelSimpleIcon,
  GearSixIcon,
  GlobeHemisphereWestIcon,
  GlobeIcon,
  HashIcon,
  HeartIcon,
  HourglassMediumIcon,
  HouseIcon,
  InfoIcon,
  KeyIcon,
  LightningIcon,
  LinkSimpleIcon,
  ListChecksIcon,
  LockIcon,
  MagnifyingGlassIcon,
  MagnifyingGlassMinusIcon,
  MegaphoneIcon,
  NotePencilIcon,
  PaletteIcon,
  PaperPlaneRightIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PencilSimpleLineIcon,
  PlusIcon,
  PulseIcon,
  QuestionIcon,
  ReceiptIcon,
  RepeatIcon,
  RocketLaunchIcon,
  RowsIcon,
  ScalesIcon,
  ShareNetworkIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  SmileyIcon,
  SparkleIcon,
  SpinnerIcon,
  SquaresFourIcon,
  SquareSplitHorizontalIcon,
  StackIcon,
  TrashIcon,
  TrendUpIcon,
  TrophyIcon,
  UserCheckIcon,
  UserIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
  UsersThreeIcon,
  WalletIcon,
  AppleLogoIcon,
  XLogoIcon,
  CurrencyEthIcon,
  GoogleLogoIcon,
  SignInIcon,
  SignOutIcon,
  TicketIcon,
  WarningCircleIcon,
  WarningIcon,
  WifiSlashIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";

export type AppIconProps = Omit<IconProps, "weight"> & {
  /** Accepted from stroke-icon call sites; a Phosphor weight is fixed per role. */
  strokeWidth?: number | string;
  /** Accepted from stroke-icon call sites; state is carried by colour instead. */
  fill?: string;
};
export type AppIcon = ReturnType<typeof glyph>;

function glyph(
  Source: Glyph,
  weight: "fill" | "bold" | "regular",
  name: string,
) {
  const Icon = forwardRef<SVGSVGElement, AppIconProps>(
    function Icon(props, ref) {
      const rest: AppIconProps = { ...props };
      delete rest.strokeWidth;
      delete rest.fill;
      const labelled = Boolean(rest["aria-label"] || rest.alt);
      return (
        <Source
          ref={ref}
          weight={weight}
          size={24}
          aria-hidden={labelled ? undefined : true}
          focusable="false"
          {...rest}
        />
      );
    },
  );
  Icon.displayName = name;
  return Icon;
}
const fill = (Source: Glyph, name: string) => glyph(Source, "fill", name);
const bold = (Source: Glyph, name: string) => glyph(Source, "bold", name);
const regular = (Source: Glyph, name: string) => glyph(Source, "regular", name);

/* Direction and control marks: bold. */
export const ArrowDownRight = bold(ArrowDownRightIcon, "ArrowDownRight");
export const ArrowLeft = bold(ArrowLeftIcon, "ArrowLeft");
export const ArrowRight = bold(ArrowRightIcon, "ArrowRight");
export const ArrowUp = bold(ArrowUpIcon, "ArrowUp");
export const ArrowUpRight = bold(ArrowUpRightIcon, "ArrowUpRight");
export const At = bold(AtIcon, "At");
export const ArrowsDownUp = bold(ArrowsDownUpIcon, "ArrowsDownUp");
export const ArrowsLeftRight = bold(ArrowsLeftRightIcon, "ArrowsLeftRight");
export const CaretDown = bold(CaretDownIcon, "CaretDown");
export const CaretLeft = bold(CaretLeftIcon, "CaretLeft");
export const CaretRight = bold(CaretRightIcon, "CaretRight");
export const ChevronDown = CaretDown;
export const ChevronRight = CaretRight;
export const Check = bold(CheckIcon, "Check");
export const CheckCheck = bold(ChecksIcon, "CheckCheck");
export const DotsThree = bold(DotsThreeIcon, "DotsThree");
export const MoreHorizontal = DotsThree;
export const Export = bold(ExportIcon, "Export");
export const Hash = bold(HashIcon, "Hash");
export const Share = Export;
export const ShareNetwork = bold(ShareNetworkIcon, "ShareNetwork");
export const Link2 = bold(LinkSimpleIcon, "Link2");
export const Copy = bold(CopySimpleIcon, "Copy");
export const Download = bold(DownloadSimpleIcon, "Download");
export const Plus = bold(PlusIcon, "Plus");
export const X = bold(XIcon, "X");

/* Objects, places and actions: fill. */
export const Activity = fill(PulseIcon, "Activity");
export const ArrowClockwise = fill(ArrowClockwiseIcon, "ArrowClockwise");
export const RotateCw = ArrowClockwise;
export const RotateCcw = fill(ArrowCounterClockwiseIcon, "RotateCcw");
export const Bank = fill(BankIcon, "Bank");
export const Landmark = Bank;
export const Basketball = fill(BasketballIcon, "Basketball");
export const Bell = fill(BellIcon, "Bell");
export const BellOff = fill(BellSlashIcon, "BellOff");
export const BookOpen = fill(BookOpenIcon, "BookOpen");
export const BookmarkSimple = fill(BookmarkSimpleIcon, "BookmarkSimple");
export const Bookmark = BookmarkSimple;
export const BookmarkCheck = BookmarkSimple;
export const BookmarkPlus = BookmarkSimple;
export const ChartBar = fill(ChartBarIcon, "ChartBar");
export const ChartNoAxesCombined = ChartBar;
export const ChartPieSlice = fill(ChartPieSliceIcon, "ChartPieSlice");
export const PieChart = ChartPieSlice;
export const ChatCircle = fill(ChatCircleIcon, "ChatCircle");
export const MessageCircle = ChatCircle;
export const MessageSquare = ChatCircle;
export const CheckCircle = fill(CheckCircleIcon, "CheckCircle");
export const CircleCheck = CheckCircle;
export const CircleDashed = fill(CircleDashedIcon, "CircleDashed");
export const CircleHelp = fill(QuestionIcon, "CircleHelp");
export const CircleX = fill(XCircleIcon, "CircleX");
export const Clock = fill(ClockIcon, "Clock");
export const Clock3 = Clock;
export const CloudLightning = fill(CloudLightningIcon, "CloudLightning");
export const Compass = fill(CompassIcon, "Compass");
export const Cpu = fill(CpuIcon, "Cpu");
export const CurrencyBtc = fill(CurrencyBtcIcon, "CurrencyBtc");
export const Bitcoin = CurrencyBtc;
export const DotsSixVertical = fill(DotsSixVerticalIcon, "DotsSixVertical");
export const GripVertical = DotsSixVertical;
export const Eye = fill(EyeIcon, "Eye");
export const EyeOff = fill(EyeSlashIcon, "EyeOff");
export const FilmSlate = fill(FilmSlateIcon, "FilmSlate");
export const Clapperboard = FilmSlate;
export const Flag = fill(FlagIcon, "Flag");
export const Flask = fill(FlaskIcon, "Flask");
export const FlaskConical = Flask;
export const FunnelSimple = fill(FunnelSimpleIcon, "FunnelSimple");
export const ListFilter = FunnelSimple;
export const GearSix = fill(GearSixIcon, "GearSix");
export const Settings = GearSix;
export const Globe = fill(GlobeIcon, "Globe");
export const Globe2 = fill(GlobeHemisphereWestIcon, "Globe2");
export const Heart = fill(HeartIcon, "Heart");
export const History = fill(ClockCounterClockwiseIcon, "History");
export const Hourglass = fill(HourglassMediumIcon, "Hourglass");
export const House = fill(HouseIcon, "House");
export const Info = fill(InfoIcon, "Info");
export const KeyRound = fill(KeyIcon, "KeyRound");
export const Layers = fill(StackIcon, "Layers");
export const LayoutGrid = fill(SquaresFourIcon, "LayoutGrid");
export const SquaresFour = LayoutGrid;
export const Lightning = fill(LightningIcon, "Lightning");
export const ListChecks = fill(ListChecksIcon, "ListChecks");
export const Lock = fill(LockIcon, "Lock");
/* Search keeps the plain outline lens; a filled lens reads as a blob. */
export const MagnifyingGlass = regular(MagnifyingGlassIcon, "MagnifyingGlass");
export const Search = MagnifyingGlass;
export const MagnifyingGlassMinus = regular(
  MagnifyingGlassMinusIcon,
  "MagnifyingGlassMinus",
);
export const SearchX = MagnifyingGlassMinus;
export const MailCheck = fill(EnvelopeSimpleIcon, "MailCheck");
export const Megaphone = fill(MegaphoneIcon, "Megaphone");
export const Vote = Megaphone;
export const NotebookPen = fill(NotePencilIcon, "NotebookPen");
export const Palette = fill(PaletteIcon, "Palette");
export const PencilSimple = fill(PencilSimpleIcon, "PencilSimple");
export const Pencil = PencilSimple;
export const PencilSimpleLine = fill(PencilSimpleLineIcon, "PencilSimpleLine");
export const PenLine = PencilSimpleLine;
export const ReceiptText = fill(ReceiptIcon, "ReceiptText");
export const Repeat = fill(RepeatIcon, "Repeat");
export const Repeat2 = Repeat;
export const RocketLaunch = fill(RocketLaunchIcon, "RocketLaunch");
export const Rocket = RocketLaunch;
export const Rows3 = fill(RowsIcon, "Rows3");
export const Rows = Rows3;
export const Scale = fill(ScalesIcon, "Scale");
export const Send = fill(PaperPlaneRightIcon, "Send");
export const PaperPlaneTilt = fill(PaperPlaneTiltIcon, "PaperPlaneTilt");
export const Shield = fill(ShieldIcon, "Shield");
export const ShieldCheck = fill(ShieldCheckIcon, "ShieldCheck");
export const SlidersHorizontal = fill(
  SlidersHorizontalIcon,
  "SlidersHorizontal",
);
export const Smile = fill(SmileyIcon, "Smile");
export const Sparkles = fill(SparkleIcon, "Sparkles");
export const Spinner = fill(SpinnerIcon, "Spinner");
export const LoaderCircle = Spinner;
export const SquareSplitHorizontal = fill(
  SquareSplitHorizontalIcon,
  "SquareSplitHorizontal",
);
export const Trash2 = fill(TrashIcon, "Trash2");
export const TrendUp = fill(TrendUpIcon, "TrendUp");
export const TrendingUp = TrendUp;
export const Trophy = fill(TrophyIcon, "Trophy");
export const User = fill(UserIcon, "User");
export const UserRound = User;
export const UserCheck = fill(UserCheckIcon, "UserCheck");
export const UserMinus = fill(UserMinusIcon, "UserMinus");
export const UserPlus = fill(UserPlusIcon, "UserPlus");
export const Users = fill(UsersIcon, "Users");
export const UsersThree = fill(UsersThreeIcon, "UsersThree");
export const UsersRound = UsersThree;
export const Wallet = fill(WalletIcon, "Wallet");
export const AppleLogo = fill(AppleLogoIcon, "AppleLogo");
export const XLogo = bold(XLogoIcon, "XLogo");
export const CurrencyEth = fill(CurrencyEthIcon, "CurrencyEth");
export const GoogleLogo = bold(GoogleLogoIcon, "GoogleLogo");
export const SignIn = fill(SignInIcon, "SignIn");
export const SignOut = fill(SignOutIcon, "SignOut");
export const Ticket = fill(TicketIcon, "Ticket");
export const WarningCircle = fill(WarningCircleIcon, "WarningCircle");
export const CircleAlert = WarningCircle;
export const TriangleAlert = fill(WarningIcon, "TriangleAlert");
export const Warning = TriangleAlert;
export const WifiSlash = fill(WifiSlashIcon, "WifiSlash");
