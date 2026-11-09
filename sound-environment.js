// Keep the original outdoor sound; only indoor rain is heard through the building.
export function createSoundEnvironment(context, { filter, gain }) {
  let previousCutoff;
  let previousVolume;
  let wasMuffled = false;

  return {
    update({ weather = 'clear', indoor = false, enabled = false, rainAmount } = {}) {
      const rain = Number.isFinite(rainAmount) ? Math.max(0, Math.min(1, rainAmount)) : (weather === 'rain' ? 1 : 0);
      const muffled = rain > 0 && indoor;
      const cutoff = 600 + ((indoor ? 650 : 2100) - 600) * rain;
      const volume = enabled ? .06 + ((indoor ? .045 : .16) - .06) * rain : 0;
      const changingMuffling = muffled !== wasMuffled;
      const now = context.currentTime;

      // AudioParam targets start from the current sound, even during rapid changes.
      // Cache each target so time-of-day animation cannot continually reschedule it.
      if (cutoff !== previousCutoff) {
        filter.frequency.setTargetAtTime(cutoff, now, changingMuffling ? .35 : 1);
        previousCutoff = cutoff;
      }
      if (volume !== previousVolume) {
        gain.gain.setTargetAtTime(volume, now, changingMuffling ? .35 : .5);
        previousVolume = volume;
      }
      wasMuffled = muffled;
    },
  };
}
