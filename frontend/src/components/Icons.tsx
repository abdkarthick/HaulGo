import { ReactNode } from "react";

/** Minimal 24px stroke icons (no emoji) so the interface looks consistent on every device. */
const base = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const mk = (d: ReactNode) => ({ size = 22, className = "" }: { size?: number; className?: string }) => (<svg {...base} width={size} height={size} className={className} aria-hidden="true">{d}</svg>);

export const IcHome = mk(<><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /><path d="M10 19.5v-5h4v5" /></>);
export const IcTruck = mk(<><path d="M2.5 6.5h11v10h-11z" /><path d="M13.5 10h4l3 3.2v3.3h-7" /><circle cx="7" cy="17.5" r="1.7" /><circle cx="17" cy="17.5" r="1.7" /></>);
export const IcBox = mk(<><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></>);
export const IcUser = mk(<><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20c.8-3.6 3.7-5.5 7.5-5.5s6.7 1.9 7.5 5.5" /></>);
export const IcBell = mk(<><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>);
export const IcGlobe = mk(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 3.7 5.2 3.7 8.5s-1.2 6.100-3.700 8.500c-2.500-2.400-3.700-5.200-3.700-8.500S9.500 5.900 12 3.500z" /></>);
export const IcBolt = mk(<path d="M13 2.5 5 13.500h6l-1 8 8-11h-6z" />);
export const IcCalendar = mk(<><rect x="3.500" y="5" width="17" height="15.500" rx="3" /><path d="M3.500 10h17M8 3v4M16 3v4" /></>);
export const IcShield = mk(<><path d="M12 3 4.500 6v5.500c0 4.500 3 8 7.500 9.500 4.500-1.500 7.500-5 7.500-9.500V6z" /><path d="m9 12 2.200 2.200L15.500 10" /></>);
export const IcPin = mk(<><path d="M12 21s6.500-5.700 6.500-11a6.500 6.500 0 0 0-13 0c0 5.300 6.500 11 6.500 11z" /><circle cx="12" cy="10" r="2.300" /></>);
export const IcReceipt = mk(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>);
export const IcArrow = mk(<path d="M5 12h14m-5-5 5 5-5 5" />);
export const IcRepeat = mk(<><path d="M4 11V9a3 3 0 0 1 3-3h11" /><path d="m15 3 3 3-3 3" /><path d="M20 13v2a3 3 0 0 1-3 3H6" /><path d="m9 21-3-3 3-3" /></>);
export const IcCheck = mk(<path d="m5 12.500 4.500 4.500L19 7.500" />);
export const IcWallet = mk(<><path d="M4 7.500h14.500a1.500 1.500 0 0 1 1.500 1.500v9a1.500 1.500 0 0 1-1.500 1.500H5.500A1.500 1.500 0 0 1 4 18z" /><path d="M4 7.500 15.500 4.500v3" /><circle cx="16.500" cy="13.500" r="1.100" /></>);
export const IcMic = mk(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3" /></>);
export const IcSend = mk(<path d="M4 12 20 4l-6 16-2.500-6.500z" />);
export const IcSpeaker = mk(<><path d="M4 9.500h3.500L12 6v12l-4.500-3.500H4z" /><path d="M15.500 9a4 4 0 0 1 0 6M18 6.500a7.500 7.500 0 0 1 0 11" /></>);
export const IcChatBubble = mk(<path d="M4 5.500h16v11H10l-4.500 3.500v-3.500H4z" />);
export const IcClose = mk(<path d="m6 6 12 12M18 6 6 18" />);
export const IcStop = mk(<rect x="6.500" y="6.500" width="11" height="11" rx="2" />);
export const IcChart = mk(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>);
export const IcRadar = mk(<><circle cx="12" cy="12" r="8.500" /><circle cx="12" cy="12" r="4.500" /><path d="M12 12 18 6" /></>);
export const IcBuilding = mk(<><path d="M5 21V4.500h9V21M14 9.500h5V21M3 21h18" /><path d="M8 8.500h3M8 12h3M8 15.500h3" /></>);
export const IcSliders = mk(<><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>);
export const IcAlert = mk(<><path d="M12 3.500 2.500 20h19z" /><path d="M12 10v4.500M12 17.500v.1" /></>);
export const IcInbox = mk(<><path d="M3.500 13.500 6 5h12l2.500 8.500V19h-17z" /><path d="M3.500 13.500H9a3 3 0 0 0 6 0h5.500" /></>);
