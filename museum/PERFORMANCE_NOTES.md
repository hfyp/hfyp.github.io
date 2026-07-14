# Museum performance baseline

This note records the changes that made the first-person museum feel smooth. Keep these constraints when extending the scene.

## Why version 8 is smooth

1. **Held input is state, not repeated events.** `keydown` adds a physical key code to `pressedKeys`; `keyup` removes it. The animation loop reads that state every frame. OS/browser key-repeat never advances the camera.
2. **Movement is time-based.** World-space velocity is integrated using frame delta time. Exponential acceleration makes starting responsive, and exponential drag provides a short coast after release.
3. **Movement and rendering share one loop.** Camera coordinates are updated immediately before every render, so the projected scene advances continuously instead of jumping once per keyboard event.
4. **Exhibit lighting is mostly fake.** Eleven per-poster spotlights were replaced with emissive paper materials and emissive lamp bars. The visible lighting cue remains, without evaluating eleven additional lights for every shaded pixel.
5. **Static shadows are rendered once.** Geometry and lights do not move, so rebuilding an identical shadow map every frame was wasted work.
6. **Motion uses dynamic resolution.** Pixel ratio falls from at most `1.75` to `1.05` while moving, cutting the pixel workload to roughly 36% of resting quality. Full detail returns shortly after movement stops.
7. **Nonvisual work is throttled.** Raycasting, room labels, the minimap, and diagnostic DOM text update several times per second rather than every rendered frame.
8. **Geometry no longer intersects the exhibits.** Poster frames use four narrow rails instead of a solid box behind each plane, avoiding visual obstruction and unnecessary overdraw.

## Preserve these rules

- Prefer baked textures, emissive materials, and fake fixture meshes over one real-time light per exhibit.
- Keep at most a small number of broad scene lights; avoid shadow-casting point and spot lights.
- Never move the player from `keydown` repeat events.
- Keep all continuous camera motion inside the renderer's frame loop and multiply by delta time.
- Keep dynamic pixel ratio and restore high detail only after the player settles.
- Keep shadow maps static unless an object or light that casts a shadow actually moves.
- Throttle HTML overlays and raycasts independently from the 3D render rate.
- Watch the diagnostic FPS before adding post-processing, reflections, video textures, or high-resolution assets.

## Current motion values

- Walk speed: `10.5 m/s`
- Sprint speed: `16 m/s`
- Acceleration response: `12`
- Release drag: `5.2`
- Moving pixel ratio cap: `1.05`
- Resting pixel ratio cap: `1.75`
- Detail restore delay: `220 ms`
