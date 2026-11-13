/*
  Homepage hero video reel — the clips play one after another, crossfading,
  then the list repeats.

  HOW TO ADD CLIPS
    1. Put the files in  dia-shoppe-frontend/public/hero/   (e.g. clip-1.mp4)
    2. List them below, in the order they should play:
         { src: '/hero/clip-1.mp4', poster: '/hero/clip-1.jpg' },
       `poster` (a still frame shown while the clip loads) is optional.

  Recommended clips: 3–4 clips of 8–9 s each, showing OUR products or people
  using them. MP4 (H.264), 1920×1080, no sound (the hero is always muted),
  ideally under ~4 MB each so the homepage stays fast.

  While this list is empty, the hero keeps playing /hero-vid.mp4 on a loop.
  Only add footage Dia Shoppe owns or is licensed to use.
*/
export const heroClips = [
  { src: '/hero/glucometer.mp4', poster: '/hero/glucometer.jpg' },   // finger-prick glucose test
  { src: '/hero/oximeter.mp4', poster: '/hero/oximeter.jpg' },       // pulse oximeter reading
  { src: '/hero/wheelchair.mp4', poster: '/hero/wheelchair.jpg' },   // self-propelled wheelchair
]
