/**
 * HeroBackdrop — original credit-score gauge artwork behind the home hero:
 * a dark speedometer-style dial (red → amber → green arc, 300–850 scale,
 * red needle), rising green trend arrows, and soft gold light, all darkened
 * so the headline stays readable. Pure SVG/CSS: sharp at any size, no download.
 */
const TICKS = Array.from({ length: 56 }, (_, i) => i);

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 180) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export default function HeroBackdrop() {
  const cx = 620;
  const cy = 620;
  const labels = [
    { v: "300", d: 0 },
    { v: "450", d: 49 },
    { v: "550", d: 82 },
    { v: "650", d: 115 },
    { v: "750", d: 148 },
    { v: "850", d: 180 },
  ];
  const needle = polar(cx, cy, 380, 88);
  return (
    <div className="hero-backdrop" aria-hidden="true">
      <svg className="hero-gauge" viewBox="0 0 1240 760" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="hb-arc" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#b3121b" />
            <stop offset=".42" stopColor="#e0462a" />
            <stop offset=".62" stopColor="#f0b44c" />
            <stop offset="1" stopColor="#22a35a" />
          </linearGradient>
          <radialGradient id="hb-face" cx=".5" cy="1" r=".9">
            <stop offset="0" stopColor="#262626" />
            <stop offset=".7" stopColor="#121212" />
            <stop offset="1" stopColor="#070707" />
          </radialGradient>
          <radialGradient id="hb-hub" cx=".4" cy=".35" r=".7">
            <stop offset="0" stopColor="#6a6a6a" />
            <stop offset=".5" stopColor="#2a2a2a" />
            <stop offset="1" stopColor="#0c0c0c" />
          </radialGradient>
          <filter id="hb-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <circle cx={cx} cy={cy} r="470" fill="url(#hb-face)" />
        <path d={`M ${cx - 420} ${cy} A 420 420 0 0 1 ${cx + 420} ${cy}`} fill="none" stroke="url(#hb-arc)" strokeWidth="34" opacity=".9" />
        <path d={`M ${cx - 420} ${cy} A 420 420 0 0 1 ${cx + 420} ${cy}`} fill="none" stroke="url(#hb-arc)" strokeWidth="34" opacity=".55" filter="url(#hb-glow)" />
        {TICKS.map((i) => {
          const deg = (i / (TICKS.length - 1)) * 180;
          const major = i % 5 === 0;
          const a = polar(cx, cy, 392, deg);
          const b = polar(cx, cy, major ? 352 : 370, deg);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#d8d2c4" strokeOpacity={major ? 0.7 : 0.35} strokeWidth={major ? 4 : 2} />;
        })}
        {labels.map(({ v, d }) => {
          const p = polar(cx, cy, 300, d);
          return <text key={v} x={p.x} y={p.y} className="hb-label" textAnchor="middle" dominantBaseline="middle">{v}</text>;
        })}
        <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke="#e0262f" strokeWidth="12" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke="#ff3b3b" strokeWidth="12" strokeLinecap="round" opacity=".6" filter="url(#hb-glow)" />
        <circle cx={cx} cy={cy} r="70" fill="url(#hb-hub)" stroke="#3a3a3a" strokeWidth="3" />
        <polyline className="hb-trend" points="40,640 170,600 260,615 380,520 470,540 600,420 700,445 820,300 930,330 1080,160" />
        <polygon className="hb-trend-head" points="1080,160 1040,170 1072,200" />
        <polyline className="hb-trend faint" points="120,720 250,690 340,700 470,610 560,630 690,520 800,540 930,400 1030,420 1180,250" />
        <text x="980" y="150" className="hb-delta">+52</text>
        <text x="200" y="250" className="hb-delta faint">+38</text>
      </svg>
      <div className="hero-glow" />
      <div className="hero-shade" />
    </div>
  );
}
