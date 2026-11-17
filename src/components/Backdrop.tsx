import { useState } from 'react';

export function Backdrop() {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-gradient-to-b from-[#172334] via-[#1f3447] to-[#213a3d]"
    >
      {!imgFailed && (
        <img
          src="/src/assets/images/alpine_twilight_scenery_1794907823659.jpg"
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover object-center opacity-85"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/55 via-slate-950/35 to-slate-950/65" />
    </div>
  );
}
