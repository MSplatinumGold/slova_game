import { useEffect, useState } from 'react';
import type { WordTopic } from '../../shared/types';

interface BackdropProps {
  topic?: WordTopic;
}

const TOPIC_BACKDROPS: Record<
  WordTopic,
  { src: string; gradient: string }
> = {
  all: {
    src: '/src/assets/images/alpine_twilight_scenery_1794907823659.jpg',
    gradient: 'from-[#172334] via-[#1f3447] to-[#213a3d]',
  },
  summer: {
    src: '/src/assets/images/summer_coast_scenery_1794911273546.jpg',
    gradient: 'from-[#1b3a4b] via-[#275d6e] to-[#2c4f3d]',
  },
  nature: {
    src: '/src/assets/images/nature_forest_scenery_1794911274102.jpg',
    gradient: 'from-[#152d26] via-[#1f4037] to-[#1e2d3b]',
  },
  travel: {
    src: '/src/assets/images/travel_harbor_scenery_1794911274410.jpg',
    gradient: 'from-[#17283b] via-[#1e3a5f] to-[#2b3445]',
  },
  home: {
    src: '/src/assets/images/home_cozy_scenery_1794911275900.jpg',
    gradient: 'from-[#231d19] via-[#2f251f] to-[#1e242b]',
  },
  science: {
    src: '/src/assets/images/science_cosmos_scenery_1794911274842.jpg',
    gradient: 'from-[#0d1326] via-[#17203d] to-[#1d2742]',
  },
};

export function Backdrop({ topic = 'all' }: BackdropProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const current = TOPIC_BACKDROPS[topic] ?? TOPIC_BACKDROPS.all;

  useEffect(() => {
    setImgFailed(false);
  }, [current.src]);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-gradient-to-b ${current.gradient} transition-colors duration-500`}
    >
      {!imgFailed && (
        <img
          key={current.src}
          src={current.src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover object-center opacity-85 transition-opacity duration-500"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/60 via-slate-950/38 to-slate-950/70" />
    </div>
  );
}
