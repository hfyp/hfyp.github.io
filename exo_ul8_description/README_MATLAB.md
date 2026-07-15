# EXO-UL8 MATLAB viewer

Keep `exo_ul8_viewer.m`, `exoul8.xml`, and the 16 `link*.stl` files together in
this directory. In MATLAB, run:

```matlab
cd('/Users/yipeng/Works/PhD_Application/hfyp.github.io/exo_ul8_description')
exo_ul8_viewer
```

You can also pass the XML explicitly:

```matlab
exo_ul8_viewer('/full/path/to/exoul8.xml')
```

The window displays both sides of the exoskeleton. The **Right arm** and
**Left arm** tabs each contain seven live sliders. Slider values are in degrees
and are constrained to the `range` values from the MuJoCo XML.

The axes use a transparent background and direct STL bounds so the complete
model is framed on startup. Use the **Scale** slider to zoom between `0.4x` and
`2.0x`, or click **Fit** to restore the full-model view. **Save transparent PNG**
exports the current view with a real alpha-transparent background. MATLAB UI
windows do not support making the entire native window alpha-transparent, so
the PNG export is the fully transparent output.

Requirements: MATLAB R2020b or newer is recommended. `stlread` must be
available (it is included in current MATLAB releases). No URDF conversion or
Robotics System Toolbox is needed because the viewer reads this MJCF file
directly.
