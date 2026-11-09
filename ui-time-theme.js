const clampNight = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
export const UI_THEME_TRANSITION_SECONDS = 6;

// Give the interface its own long twilight, independent of the steeper lighting
// curve. A five-minute day spends fifty real seconds crossing each color ramp.
export function getUiNightForMinutes(minutes) {
  if (!Number.isFinite(minutes)) return 0;
  const hour = ((minutes % 1440 + 1440) % 1440) / 60;
  if (hour < 4 || hour >= 20) return 1;
  if (hour < 8) return (8 - hour) / 4;
  if (hour <= 16) return 0;
  return (hour - 16) / 4;
}

// Keep readable paper and ink steady; only quiet sage accents follow the clock.
const COLORS = {
  '--ink': [[45, 68, 59, 1], [45, 68, 59, 1]],
  '--soft': [[82, 101, 88, 1], [82, 101, 88, 1]],
  '--line': [[61, 82, 61, .13], [61, 82, 61, .22]],
  '--glass': [[251, 252, 241, .96], [251, 252, 241, .96]],
  '--accent': [[65, 95, 65, 1], [65, 95, 65, 1]],
  '--icon-background': [[251, 252, 241, .96], [251, 252, 241, .96]],
  '--view-active': [[223, 230, 211, 1], [211, 223, 200, 1]],
  '--view-hover': [[229, 234, 220, 1], [219, 229, 208, 1]],
  '--weather-active': [[229, 235, 220, 1], [211, 223, 200, 1]],
  '--dock-border': [[255, 255, 255, .75], [111, 138, 104, .32]],
  '--tools-border': [[255, 255, 255, .6], [111, 138, 104, .32]],
  '--live-dot': [[107, 140, 80, 1], [113, 144, 92, 1]],
  '--dither-active': [[223, 230, 211, 1], [211, 223, 200, 1]],
  '--dither-border': [[106, 130, 85, 64 / 255], [105, 135, 88, .45]],
};

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
const serialize = color => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3]})`;

/** CSS token values for a single, continuous day/night position. */
export function getTimeTheme(night) {
  const position = clampNight(night);
  const theme = {};
  for (const [name, [day, dark]] of Object.entries(COLORS)) {
    if (position === 0 || position === 1) {
      theme[name] = serialize(position === 0 ? day : dark);
    } else {
      theme[name] = serialize(day.map((channel, index) =>
        round(channel + (dark[index] - channel) * position, index === 3 ? 6 : 3)));
    }
  }
  return theme;
}

/** Move every token together, with six seconds of visible color for a full jump. */
export function createTimeTheme(rootStyle, {initialNight = 0} = {}) {
  let night = clampNight(initialNight);
  let target = night;
  const previous = new Map();

  function writeTheme() {
    for (const [name, value] of Object.entries(getTimeTheme(night))) {
      if (previous.get(name) === value) continue;
      rootStyle.setProperty(name, value);
      previous.set(name, value);
    }
  }

  writeTheme();

  return {
    setNight(value) {
      target = clampNight(value);
    },
    update(delta) {
      if (night === target || !Number.isFinite(delta) || delta <= 0) return night;
      const remaining = target - night;
      night += Math.sign(remaining) * Math.min(Math.abs(remaining), delta / UI_THEME_TRANSITION_SECONDS);
      if (Math.abs(target - night) < 1e-9) night = target;
      writeTheme();
      return night;
    },
    get night() { return night; },
    get target() { return target; },
  };
}
