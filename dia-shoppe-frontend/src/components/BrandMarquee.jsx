/*
  White top strip with the real brand logos. Each logo is an individual
  transparent/white PNG in /public/logos ("pic 1.png" … "pic 18.png").
  They scroll continuously; hover pauses the marquee.
*/
const brands = [
  { n: 1,  name: 'LifeScan' },
  { n: 2,  name: 'K-Life' },
  { n: 3,  name: 'Krups' },
  { n: 4,  name: 'FreeStyle' },
  { n: 5,  name: 'B. Braun' },
  { n: 6,  name: 'mylife Pura' },
  { n: 7,  name: 'Roche Accu-Chek' },
  { n: 8,  name: 'Littmann Stethoscope' },
  { n: 9,  name: 'Arkray' },
  { n: 10, name: 'Wockhardt' },
  { n: 11, name: 'Infi' },
  { n: 12, name: 'Instapro' },
  { n: 13, name: 'Flamingo' },
  { n: 14, name: 'Dr. Morepen' },
  { n: 15, name: 'Philips Healthcare' },
  { n: 16, name: 'Citizen' },
  { n: 17, name: 'Diamond BP Apparatus' },
  { n: 18, name: 'Bayer Ascensia' },
]

function LogoTile({ brand }) {
  return (
    <div className="shrink-0 px-6 flex items-center">
      <img
        src={encodeURI(`/logos/pic ${brand.n}.png`)}
        alt={brand.name}
        title={brand.name}
        loading="lazy"
        className="h-10 w-auto max-w-[140px] object-contain"
      />
    </div>
  )
}

export default function BrandMarquee() {
  const loop = [...brands, ...brands]
  return (
    <div className="bg-white border-b border-gray-100 overflow-hidden py-3 relative z-50">
      <div className="flex w-max items-center animate-marquee-reverse hover:[animation-play-state:paused]">
        {loop.map((brand, i) => (
          <LogoTile key={i} brand={brand} />
        ))}
      </div>
    </div>
  )
}
