import { useExperimentStore } from '../../stores/experimentStore';

export default function DetectorSelector() {
  const {
    detectorDescriptors,
    detectorSelection,
    toggleMalsAngle,
    toggleRI,
    toggleUVWavelength,
    setMalsGroup,
    setUVGroup,
    selectAllDetectors,
    deselectAllDetectors,
  } = useExperimentStore();

  if (detectorDescriptors.length === 0) {
    return null;
  }

  const malsDesc = detectorDescriptors.find((d) => d.type === 'MALS');
  const riDesc = detectorDescriptors.find((d) => d.type === 'RI');
  const uvDesc = detectorDescriptors.find((d) => d.type === 'UV');

  const malsChannels = malsDesc?.subChannels ?? [];
  const uvChannels = uvDesc?.subChannels ?? [];
  const malsAllOn =
    malsChannels.length > 0 &&
    malsChannels.every((c) => detectorSelection.malsAngles.has(c.index));
  const uvAllOn =
    uvChannels.length > 0 &&
    uvChannels.every((c) => detectorSelection.uvWavelengths.has(c.index));

  return (
    <div className="bg-white border-b border-slate-200 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-700">Detectors</h3>
        <div className="flex gap-2">
          <button
            onClick={selectAllDetectors}
            className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
          >
            Select All
          </button>
          <button
            onClick={deselectAllDetectors}
            className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
          >
            Deselect All
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {/* MALS */}
        {malsDesc && (
          <div className="min-w-0">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5 cursor-pointer hover:text-brand-600">
              <input
                type="checkbox"
                checked={malsAllOn}
                ref={(el) => {
                  if (el)
                    el.indeterminate =
                      !malsAllOn && detectorSelection.malsAngles.size > 0;
                }}
                onChange={(e) => setMalsGroup(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                title="Toggle all MALS angles"
              />
              {malsDesc.name || 'MALS'}
            </label>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {malsDesc.subChannels?.map((ch) => (
                <label
                  key={ch.index}
                  className="flex items-center gap-1.5 text-xs cursor-pointer hover:text-brand-600"
                >
                  <input
                    type="checkbox"
                    checked={detectorSelection.malsAngles.has(ch.index)}
                    onChange={() => toggleMalsAngle(ch.index)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                  />
                  <span className="font-mono">{ch.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* RI */}
        {riDesc && (
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">
              {riDesc.name || 'RI'}
            </div>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer hover:text-brand-600">
              <input
                type="checkbox"
                checked={detectorSelection.ri}
                onChange={toggleRI}
                className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
              />
              <span>Refractive Index</span>
            </label>
          </div>
        )}

        {/* UV */}
        {uvDesc && (
          <div className="min-w-0">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5 cursor-pointer hover:text-brand-600">
              <input
                type="checkbox"
                checked={uvAllOn}
                ref={(el) => {
                  if (el)
                    el.indeterminate =
                      !uvAllOn && detectorSelection.uvWavelengths.size > 0;
                }}
                onChange={(e) => setUVGroup(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                title="Toggle all UV wavelengths"
              />
              {uvDesc.name || 'UV'}
            </label>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {uvDesc.subChannels?.map((ch) => (
                <label
                  key={ch.index}
                  className="flex items-center gap-1.5 text-xs cursor-pointer hover:text-brand-600"
                >
                  <input
                    type="checkbox"
                    checked={detectorSelection.uvWavelengths.has(ch.index)}
                    onChange={() => toggleUVWavelength(ch.index)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                  />
                  <span className="font-mono">{ch.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}