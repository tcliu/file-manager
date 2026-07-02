const TAG_HUES = [
  'rose', 'orange', 'amber', 'lime', 'emerald',
  'cyan', 'sky', 'indigo', 'purple', 'pink',
] as const;

export type TagHue = (typeof TAG_HUES)[number];

function hashTag(tag: string): number {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash) + tag.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getTagHue(tag: string, tagIndexMap?: Record<string, number>): string {
  if (tagIndexMap && Object.prototype.hasOwnProperty.call(tagIndexMap, tag)) {
    return TAG_HUES[tagIndexMap[tag] % TAG_HUES.length];
  }
  return TAG_HUES[hashTag(tag) % TAG_HUES.length];
}

export const UNTAGGED_HUE = 'slate';
export const TAGGED_HUE = 'teal';

type HueStyles = {
  chip: string;
  activeFilter: string;
  inactiveFilter: string;
  commonChip: string;
  uncommonChip: string;
  commonRemoveBtn: string;
  uncommonRemoveBtn: string;
  commonDropdown: string;
  uncommonDropdown: string;
  inactiveDropdown: string;
};

export const HUE_STYLES: Record<string, HueStyles> = {
  rose: {
    chip: 'rounded-full border px-1.5 py-0.5 text-xs border-rose-300/40 bg-rose-950/20 text-rose-300/80',
    activeFilter: 'rounded-full border-2 px-2.5 py-0.5 text-xs font-semibold transition border-rose-300/40 bg-rose-950/20 text-rose-300/80',
    inactiveFilter: 'rounded-full border px-2.5 py-0.5 text-xs transition border-rose-300/40 bg-rose-950/20 text-rose-300/80 hover:border-rose-200/50 hover:bg-rose-950/40 hover:text-rose-200',
    commonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-rose-300/50 bg-rose-950/25 text-rose-200',
    uncommonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-rose-300/30 bg-rose-950/10 text-rose-300/70',
    commonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-rose-300/60 hover:text-rose-200',
    uncommonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-rose-300/40 hover:text-rose-200/70',
    commonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-rose-500/15 text-rose-200',
    uncommonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-rose-500/10 text-rose-300/70',
    inactiveDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition text-slate-300 hover:bg-slate-800 hover:text-rose-300',
  },
  orange: {
    chip: 'rounded-full border px-1.5 py-0.5 text-xs border-orange-300/40 bg-orange-950/20 text-orange-300/80',
    activeFilter: 'rounded-full border-2 px-2.5 py-0.5 text-xs font-semibold transition border-orange-300/40 bg-orange-950/20 text-orange-300/80',
    inactiveFilter: 'rounded-full border px-2.5 py-0.5 text-xs transition border-orange-300/40 bg-orange-950/20 text-orange-300/80 hover:border-orange-200/50 hover:bg-orange-950/40 hover:text-orange-200',
    commonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-orange-300/50 bg-orange-950/25 text-orange-200',
    uncommonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-orange-300/30 bg-orange-950/10 text-orange-300/70',
    commonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-orange-300/60 hover:text-orange-200',
    uncommonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-orange-300/40 hover:text-orange-200/70',
    commonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-orange-500/15 text-orange-200',
    uncommonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-orange-500/10 text-orange-300/70',
    inactiveDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition text-slate-300 hover:bg-slate-800 hover:text-orange-300',
  },
  amber: {
    chip: 'rounded-full border px-1.5 py-0.5 text-xs border-amber-300/40 bg-amber-950/20 text-amber-300/80',
    activeFilter: 'rounded-full border-2 px-2.5 py-0.5 text-xs font-semibold transition border-amber-300/40 bg-amber-950/20 text-amber-300/80',
    inactiveFilter: 'rounded-full border px-2.5 py-0.5 text-xs transition border-amber-300/40 bg-amber-950/20 text-amber-300/80 hover:border-amber-200/50 hover:bg-amber-950/40 hover:text-amber-200',
    commonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-amber-300/50 bg-amber-950/25 text-amber-200',
    uncommonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-amber-300/30 bg-amber-950/10 text-amber-300/70',
    commonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-amber-300/60 hover:text-amber-200',
    uncommonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-amber-300/40 hover:text-amber-200/70',
    commonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-amber-500/15 text-amber-200',
    uncommonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-amber-500/10 text-amber-300/70',
    inactiveDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition text-slate-300 hover:bg-slate-800 hover:text-amber-300',
  },
  lime: {
    chip: 'rounded-full border px-1.5 py-0.5 text-xs border-lime-300/40 bg-lime-950/20 text-lime-300/80',
    activeFilter: 'rounded-full border-2 px-2.5 py-0.5 text-xs font-semibold transition border-lime-300/40 bg-lime-950/20 text-lime-300/80',
    inactiveFilter: 'rounded-full border px-2.5 py-0.5 text-xs transition border-lime-300/40 bg-lime-950/20 text-lime-300/80 hover:border-lime-200/50 hover:bg-lime-950/40 hover:text-lime-200',
    commonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-lime-300/50 bg-lime-950/25 text-lime-200',
    uncommonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-lime-300/30 bg-lime-950/10 text-lime-300/70',
    commonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-lime-300/60 hover:text-lime-200',
    uncommonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-lime-300/40 hover:text-lime-200/70',
    commonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-lime-500/15 text-lime-200',
    uncommonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-lime-500/10 text-lime-300/70',
    inactiveDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition text-slate-300 hover:bg-slate-800 hover:text-lime-300',
  },
  emerald: {
    chip: 'rounded-full border px-1.5 py-0.5 text-xs border-emerald-300/40 bg-emerald-950/20 text-emerald-300/80',
    activeFilter: 'rounded-full border-2 px-2.5 py-0.5 text-xs font-semibold transition border-emerald-300/40 bg-emerald-950/20 text-emerald-300/80',
    inactiveFilter: 'rounded-full border px-2.5 py-0.5 text-xs transition border-emerald-300/40 bg-emerald-950/20 text-emerald-300/80 hover:border-emerald-200/50 hover:bg-emerald-950/40 hover:text-emerald-200',
    commonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-emerald-300/50 bg-emerald-950/25 text-emerald-200',
    uncommonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-emerald-300/30 bg-emerald-950/10 text-emerald-300/70',
    commonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-emerald-300/60 hover:text-emerald-200',
    uncommonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-emerald-300/40 hover:text-emerald-200/70',
    commonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-emerald-500/15 text-emerald-200',
    uncommonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-emerald-500/10 text-emerald-300/70',
    inactiveDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition text-slate-300 hover:bg-slate-800 hover:text-emerald-300',
  },
  cyan: {
    chip: 'rounded-full border px-1.5 py-0.5 text-xs border-cyan-300/40 bg-cyan-950/20 text-cyan-300/80',
    activeFilter: 'rounded-full border-2 px-2.5 py-0.5 text-xs font-semibold transition border-cyan-300/40 bg-cyan-950/20 text-cyan-300/80',
    inactiveFilter: 'rounded-full border px-2.5 py-0.5 text-xs transition border-cyan-300/40 bg-cyan-950/20 text-cyan-300/80 hover:border-cyan-200/50 hover:bg-cyan-950/40 hover:text-cyan-200',
    commonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-cyan-300/50 bg-cyan-950/25 text-cyan-200',
    uncommonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-cyan-300/30 bg-cyan-950/10 text-cyan-300/70',
    commonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-cyan-300/60 hover:text-cyan-200',
    uncommonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-cyan-300/40 hover:text-cyan-200/70',
    commonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-cyan-500/15 text-cyan-200',
    uncommonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-cyan-500/10 text-cyan-300/70',
    inactiveDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition text-slate-300 hover:bg-slate-800 hover:text-cyan-300',
  },
  sky: {
    chip: 'rounded-full border px-1.5 py-0.5 text-xs border-sky-300/40 bg-sky-950/20 text-sky-300/80',
    activeFilter: 'rounded-full border-2 px-2.5 py-0.5 text-xs font-semibold transition border-sky-300/40 bg-sky-950/20 text-sky-300/80',
    inactiveFilter: 'rounded-full border px-2.5 py-0.5 text-xs transition border-sky-300/40 bg-sky-950/20 text-sky-300/80 hover:border-sky-200/50 hover:bg-sky-950/40 hover:text-sky-200',
    commonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-sky-300/50 bg-sky-950/25 text-sky-200',
    uncommonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-sky-300/30 bg-sky-950/10 text-sky-300/70',
    commonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-sky-300/60 hover:text-sky-200',
    uncommonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-sky-300/40 hover:text-sky-200/70',
    commonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-sky-500/15 text-sky-200',
    uncommonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-sky-500/10 text-sky-300/70',
    inactiveDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition text-slate-300 hover:bg-slate-800 hover:text-sky-300',
  },
  indigo: {
    chip: 'rounded-full border px-1.5 py-0.5 text-xs border-indigo-300/40 bg-indigo-950/20 text-indigo-300/80',
    activeFilter: 'rounded-full border-2 px-2.5 py-0.5 text-xs font-semibold transition border-indigo-300/40 bg-indigo-950/20 text-indigo-300/80',
    inactiveFilter: 'rounded-full border px-2.5 py-0.5 text-xs transition border-indigo-300/40 bg-indigo-950/20 text-indigo-300/80 hover:border-indigo-200/50 hover:bg-indigo-950/40 hover:text-indigo-200',
    commonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-indigo-300/50 bg-indigo-950/25 text-indigo-200',
    uncommonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-indigo-300/30 bg-indigo-950/10 text-indigo-300/70',
    commonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-indigo-300/60 hover:text-indigo-200',
    uncommonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-indigo-300/40 hover:text-indigo-200/70',
    commonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-indigo-500/15 text-indigo-200',
    uncommonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-indigo-500/10 text-indigo-300/70',
    inactiveDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition text-slate-300 hover:bg-slate-800 hover:text-indigo-300',
  },
  purple: {
    chip: 'rounded-full border px-1.5 py-0.5 text-xs border-purple-300/40 bg-purple-950/20 text-purple-300/80',
    activeFilter: 'rounded-full border-2 px-2.5 py-0.5 text-xs font-semibold transition border-purple-300/40 bg-purple-950/20 text-purple-300/80',
    inactiveFilter: 'rounded-full border px-2.5 py-0.5 text-xs transition border-purple-300/40 bg-purple-950/20 text-purple-300/80 hover:border-purple-200/50 hover:bg-purple-950/40 hover:text-purple-200',
    commonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-purple-300/50 bg-purple-950/25 text-purple-200',
    uncommonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-purple-300/30 bg-purple-950/10 text-purple-300/70',
    commonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-purple-300/60 hover:text-purple-200',
    uncommonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-purple-300/40 hover:text-purple-200/70',
    commonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-purple-500/15 text-purple-200',
    uncommonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-purple-500/10 text-purple-300/70',
    inactiveDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition text-slate-300 hover:bg-slate-800 hover:text-purple-300',
  },
  pink: {
    chip: 'rounded-full border px-1.5 py-0.5 text-xs border-pink-300/40 bg-pink-950/20 text-pink-300/80',
    activeFilter: 'rounded-full border-2 px-2.5 py-0.5 text-xs font-semibold transition border-pink-300/40 bg-pink-950/20 text-pink-300/80',
    inactiveFilter: 'rounded-full border px-2.5 py-0.5 text-xs transition border-pink-300/40 bg-pink-950/20 text-pink-300/80 hover:border-pink-200/50 hover:bg-pink-950/40 hover:text-pink-200',
    commonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-pink-300/50 bg-pink-950/25 text-pink-200',
    uncommonChip: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs border-pink-300/30 bg-pink-950/10 text-pink-300/70',
    commonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-pink-300/60 hover:text-pink-200',
    uncommonRemoveBtn: 'flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-60 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-pink-300/40 hover:text-pink-200/70',
    commonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-pink-500/15 text-pink-200',
    uncommonDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition bg-pink-500/10 text-pink-300/70',
    inactiveDropdown: 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition text-slate-300 hover:bg-slate-800 hover:text-pink-300',
  },
};

function getStyles(tag: string, tagIndexMap?: Record<string, number>): HueStyles {
  return HUE_STYLES[getTagHue(tag, tagIndexMap)] ?? HUE_STYLES.cyan;
}

export function tagFilterButtonClass(tag: string, active: boolean, tagIndexMap?: Record<string, number>): string {
  const s = getStyles(tag, tagIndexMap);
  return active ? s.activeFilter : s.inactiveFilter;
}

export function tagChipClass(tag: string, tagIndexMap?: Record<string, number>): string {
  return getStyles(tag, tagIndexMap).chip;
}

export function tagChipClassCommon(tag: string, isCommon: boolean, tagIndexMap?: Record<string, number>): string {
  const s = getStyles(tag, tagIndexMap);
  return isCommon ? s.commonChip : s.uncommonChip;
}

export function tagRemoveBtnClass(tag: string, isCommon: boolean, tagIndexMap?: Record<string, number>): string {
  const s = getStyles(tag, tagIndexMap);
  return isCommon ? s.commonRemoveBtn : s.uncommonRemoveBtn;
}

export function tagDropdownItemClass(tag: string, isSelected: boolean, isCommon: boolean, tagIndexMap?: Record<string, number>): string {
  const s = getStyles(tag, tagIndexMap);
  if (isSelected) return isCommon ? s.commonDropdown : s.uncommonDropdown;
  return s.inactiveDropdown;
}
