export const short=(s:string)=>`${s.slice(0,6)}…${s.slice(-4)}`;export const money=(v:string)=>new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(Number(v));
