type Dict = Record<string, string>;

const en: Dict = {
  title: "VertexColor 2 ColorMix",
  subtitle:
    "Browser-based OBJ vertex-colour preparation for ColorMix / Full Spectrum 3MF workflows.",
  language: "Language",
  theme: "GUI theme",
  system: "System",
  tipTheme:
    "Controls the general user-interface theme. System follows the operating-system light/dark setting.",
  import: "Import",
  loadAndSetup: "Load and setup",
  filamentList: "Filament list",
  settings: "Project data",
  settingsIntro:
    "Save or load the complete VertexColor 2 ColorMix project data, including processing state and optional embedded input files.",
  settingsHelp:
    "Saves and loads the complete project as JSON. Workflow state includes physical colours, colour correction, reduced palette, virtual-mix edits and export settings.",
  saveSettings: "Save project",
  loadSettings: "Load project",
  objFile: "OBJ file with vertex colours",
  chooseFile: "Choose file",
  modelStats: "Model statistics",
  modelName: "Model name",
  vertices: "Vertices",
  triangles: "Triangles",
  colouredVertices: "Coloured vertices",
  uniqueFaceColours: "Unique face colours",
  colours: "Colours",
  modelOrientation: "Model orientation",
  rotate90: "Rotate 90°",
  rotateLeft: "Rotate left",
  rotateRight: "Rotate right",
  rotateForward: "Rotate forward",
  rotateBackward: "Rotate backward",
  fineRotation: "Fine rotation",
  rotationAxis: "Axis",
  rotationAngle: "Angle",
  applyFineRotation: "Apply fine rotation",
  setCurrentOrientation: "Set current orientation",
  resetImportedOrientation: "Reset to imported orientation",
  orientationCurrent: "Current",
  paletteAndVirtualColours: "Palette and virtual mixtures",
  paletteWorkflowIntro:
    "Build the reduced target palette from the applied model colour correction, then map it to printable physical and virtual extruder mixtures.",
  targetPaletteSettings: "Target-palette settings",
  reducedTargetPalette: "Reduced target palette",
  printableVirtualMixes: "Printable virtual mixtures",
  paletteUsesAppliedColourAdjustment:
    "There are pending colour-correction changes. Apply them in Colour setup before recalculating the palette if those values should be used.",
  maxColours: "Virtual colours",
  blendStepPercent: "Mixing recipe resolution",
  accentProtection: "Accent colour preservation",
  accentProtectionOff: "Off",
  accentProtectionBalanced: "Balanced",
  accentProtectionStrong: "Strong",
  virtualMixPriority: "Virtual mixture model",
  mixPriorityAccurate: "Prusa FDM mixer",
  mixPriorityPreserveHue: "Prusa FDM + hue guard",
  mixPriorityAvoidMuddy: "Prusa FDM + accent split",
  mappingStrategy: "Mapping strategy",
  mappingClosest: "Closest match",
  mappingSmooth: "Smooth transitions",
  mappingHuePreserving: "Hue-preserving",
  mappingAccentPreserving: "Accent-preserving",
  virtualPreviewLightness: "Virtual preview brightness",
  virtualPreviewLightnessDarker: "Darker",
  virtualPreviewLightnessSlightlyDarker: "Slightly darker",
  virtualPreviewLightnessCalibrated: "Calibrated",
  virtualPreviewLightnessSlightlyBrighter: "Slightly brighter",
  colourAdjustment: "Colour correction",
  modelColourCorrection: "Model colour correction",
  modelColourCorrectionIntro:
    "Adjust already imported or baked vertex colours before palette reduction, filament suggestion and virtual mixing. Use this for directly loaded vertex-coloured OBJ files or externally baked models. For textured GLB/OBJ workflows, prefer Bake colour correction in Texture Baking before handoff.",
  activeColourAdjustment: "Active colour correction",
  prepareColourAdjustment: "Prepare colour correction",
  colourAdjustmentAppliedHint:
    "The reduced palette uses these applied colour-correction values. Change sliders and click Apply before recalculating the palette.",
  brightness: "Brightness",
  contrast: "Contrast",
  saturation: "Saturation",
  temperature: "Temperature",
  hue: "Hue",
  tint: "Tint",
  gamma: "Gamma",
  reset: "Reset",
  apply: "Apply",
  unappliedColourChanges:
    "Colour changes are pending. Click Apply to rebuild the adjusted model colours, reduced palette and preview.",
  applyingColourAdjustment: "Applying colour adjustment...",
  progressColourAdjustmentTitle: "Apply colour adjustment",
  progressColourAdjustmentApplySettings: "Apply slider values",
  progressColourAdjustmentRebuildColours:
    "Rebuild adjusted colours and palette input",
  progressColourAdjustmentRefreshPreview: "Refresh preview colours",
  appliedColourAdjustment: "Colour adjustment applied.",
  greyscalePresetApplied:
    "Grey-scale preset active: colour adjustment was set to greyscale.",
  greyscalePresetQueued:
    "Grey-scale preset selected. For this large model the colour preview update was deferred. Click Apply to rebuild the preview.",
  colourAdjustmentsRestored:
    "Colour adjustment restored after leaving the grey-scale preset.",
  colourAdjustmentsRestoreQueued:
    "Colour preset selected. For this large model the colour preview update was deferred. Click Apply to rebuild the preview.",
  preview: "Preview",
  sixViewPreview: "Six-view preview",
  buildingStaticPreviews: "Building six preview images...",
  back: "Back",
  left: "Left",
  right: "Right",
  bottom: "Bottom",
  interactive3dPreview: "Interactive 3D preview",
  interactive3dPreviewNote:
    "The 3D preview uses the current preview mode and display settings.",
  enable3dPreview: "Load interactive 3D preview",
  hide3dPreview: "Hide interactive 3D preview",
  view: "View",
  front: "Front",
  side: "Side",
  top: "Top",
  mode: "Mode",
  adjusted: "Adjusted colours",
  quantized: "Reduced palette",
  printSimulation: "Print simulation",
  display: "Display",
  shaded: "Shaded",
  flatColour: "Flat colour",
  background: "Background",
  previewBackgroundAuto: "GUI theme",
  previewTabs: "Preview tabs",
  light: "Light",
  dark: "Dark",
  wireframe: "Wireframe",
  axes: "Axes",
  webglPreviewLod: "LOD",
  webglLodOff: "Full",
  webglLodTiny: "Remove very small",
  webglLodSmall: "Remove small",
  webglLodMedium: "Remove medium",
  rebuildPreview: "Rebuild preview",
  reloadData: "Reload data",
  reloadApp: "Reload app",
  fitToModel: "Fit to model",
  resetView: "Reset view",
  buildingPreview: "Building WebGL preview...",
  chromiumPreviewWarning:
    "Chrome/Edge warning: this model is in the tested crash range for WebGL. Load the WebGL preview only if you accept the risk.",
  chromiumPreviewBlockedTitle: "3D preview blocked for Chrome/Edge",
  chromiumPreviewBlockedText:
    "This model is large enough that Chrome/Edge may crash while building the WebGL preview. The OBJ was parsed and palette, filament suggestion and virtual extruders remain available. Load the WebGL preview only if you explicitly accept the risk.",
  previewSafetyThreshold: "Chrome/Edge safety threshold",
  load3dPreviewAnyway: "Load 3D preview anyway",
  templateAndPhysicalColours: "3MF template / physical colours",
  physicalExtruders: "Physical extruders",
  physicalColourSource: "Colour source",
  sourcePreset: "Preset",
  sourceTemplate: "3MF template",
  sourceManual: "Hex codes",
  sourceSuggestion: "Filament list suggestion",
  preset: "Preset",
  presetBase: "Base preset",
  presetExtension: "Extension",
  chooseTemplate3mf: "Choose 3MF template",
  chooseFilamentList: "Choose filament list",
  loadingTemplate: "Loading 3MF template...",
  templateLoaded: "3MF template loaded.",
  templateLoadedNoColours:
    "3MF template loaded, but no physical colours were found.",
  noTemplateLoaded: "No 3MF template loaded.",
  templateColoursFound: "physical colours found",
  bedSize: "Bed size",
  loadingFilamentList: "Loading filament list...",
  loadingSettings: "Loading settings...",
  settingsLoaded: "Settings loaded.",
  projectLoaded: "Project loaded.",
  savingProject: "Saving project...",
  progressProjectSaveTitle: "Save project",
  progressProjectLoadTitle: "Load project",
  progressProjectCollectState: "Collect processing state",
  progressProjectEmbedFiles: "Embed selected files",
  progressProjectWriteJson: "Write project JSON",
  progressProjectReadJson: "Read project JSON",
  progressProjectRestoreFiles: "Restore embedded files",
  progressProjectRestoreState: "Restore processing state",
  progressProjectDone: "Done",
  progressOrientationTitle: "Orient model",
  progressOrientationPrepare: "Prepare orientation transform",
  progressOrientationApply: "Apply geometry orientation",
  progressOrientationRefresh: "Refresh preview",
  saveProjectContents: "Save contents",
  loadProjectContents: "Load contents",
  projectPartSettings: "Workflow state",
  projectPartModel: "OBJ model",
  projectPartTemplate: "3MF template",
  projectPartFilamentList: "Filament list",
  projectSaveLoadNote:
    "Workflow state includes physical colours, colour correction, reduced palette, virtual-mix edits and export settings. Selected files are embedded directly in the JSON project file; large OBJ files can therefore make the project file large. Missing file parts are skipped when saving or loading.",
  noSelectedProjectPartsFound:
    "No selected project parts were found in this file.",
  settingsSaved: "Project saved.",
  invalidSettingsFile: "Invalid settings file.",
  filamentListLoaded: "Filament list loaded.",
  filamentListLoadedEmpty:
    "Filament list loaded, but no valid filament colours were found.",
  noFilamentListLoaded: "No filament list loaded.",
  parsedFilaments: "parsed filaments",
  materialFilter: "Material filter",
  allMaterials: "All materials",
  materialUnknown: "No material",
  manualSelection: "Assigned slots",
  activeSlot: "Active slot",
  emptySlot: "Empty",
  clearSlot: "Clear",
  setSlot: "Set",
  assignToSlot: "To slot",
  assign: "Assign",
  clearSelection: "Clear selection",
  applySelectedFilaments: "Use selected filaments as physical colours",
  select: "Select",
  name: "Name",
  material: "Material",
  colour: "Colour",
  hexColour: "Hex colour",
  noFilamentsForFilter: "No filaments match this material filter.",
  manualFilamentSelectionApplied:
    "Selected filaments were applied as physical colours.",
  manualSelectionOutsideFilterWarning:
    "One or more manually assigned slots do not match the current material filter. They remain assigned, but the automatic suggestion uses only the filtered material.",
  tipMaterialFilter:
    "Limits filament suggestions and the table to one material type. This avoids mixing PLA, PETG, ASA, TPU and similar materials in one ColorMix setup.",
  tipFilamentTable:
    "Loaded filament list. Sort by name, material, or colour. Colour sorting follows the visible spectrum from red through orange, yellow, green, cyan, blue and violet. Near-neutral colours are grouped afterwards.",
  tipManualSlotGrid:
    "Manual physical-slot assignment. Select a slot, then set or replace it from the filament table below.",
  tipSelectManualSlot:
    "Selects this physical slot as the target for the next filament assignment.",
  tipColourSpectrumSort:
    "Sorts chromatic colours by spectrum, starting at red. Values near 360° hue are treated as red, not placed after magenta. Near-neutral colours are grouped afterwards from dark to light.",
  tipAssignFilamentToActiveSlot:
    "Assigns this filament to the currently active slot and replaces any existing filament in that slot.",
  tipManualFilamentCheckbox:
    "Select this filament for manual physical-slot assignment. Select exactly the number of physical extruders currently configured.",
  tipApplyManualFilamentSelection:
    "Uses the assigned slot filaments as E1..En physical colours and switches the colour source to Filament list suggestion. All configured physical extruder slots must be filled.",
  currentPhysicalColours: "Current physical colours",
  noPhysicalColoursYet:
    "No physical colours available for the selected source.",
  physicalWorkflowIntro:
    "Define the real E-slot filaments used later for virtual mixtures, print simulation and export. Changes are staged until Apply or Apply draft is used.",
  physicalDraftSection: "Prepare physical-colour source",
  unappliedPhysicalSettings:
    "Physical colour settings are pending. Click Apply to recalculate virtual mixtures.",
  physicalSettingsApplied: "Physical colour settings applied.",
  physicalSettingsReset: "Pending physical colour settings were reset.",
  greyscalePresetNote:
    "Grey-scale preset selected: saturation is automatically set to -100 and hue/tint/temperature are neutralised. Brightness, contrast and gamma remain adjustable.",
  greyscalePresetNeedsColourApply:
    "Grey-scale preset changed the colour adjustment. In Colour setup, click Apply so saturation -100 is used for palette, preview and export.",
  colourPresetNeedsColourApply:
    "Colour preset restored the colour adjustment. In Colour setup, click Apply so the neutral saturation is used for palette, preview and export.",
  manualColoursHelp:
    "Enter one hex colour per line or separated by spaces/commas. Only the first physical extruder slots are used.",
  suggest: "Calculate suggestion",
  applyDraft: "Apply draft",
  resetDraft: "Reset draft",
  unappliedSuggestionDraft:
    "Filament-suggestion draft is complete. Apply draft to use these E-slots for print simulation and export, or reset it.",
  suggestionDraftMissingSlots:
    "Draft is incomplete. Fill these slots before applying",
  suggestionDraftMatchesActive:
    "Draft matches the currently applied physical colours.",
  draftSlotAssignment: "Draft E-slot assignment",
  draftSlotAssignmentHelp:
    "Select an E-slot, then assign a filament from the table. Only Apply draft writes the draft to the active physical colours.",
  suggestionDraftCalculated:
    "Filament-suggestion draft calculated. Review or edit the E-slots, then apply the draft.",
  suggestionDraftApplied:
    "Filament-suggestion draft applied as physical colours.",
  suggestionDraftReset:
    "Filament-suggestion draft reset to the currently applied physical colours.",
  downloadPaletteCsv: "Download palette CSV",
  downloadSuggestionCsv: "Download physical colours CSV",
  statusReady: "Ready.",
  noModel: "No model loaded.",
  loading: "Loading...",
  loadingFile: "Loading OBJ file...",
  parsingObj: "Parsing OBJ...",
  parsed: "OBJ loaded and parsed.",
  largeModelComputationsDeferred:
    "OBJ parsed. Chrome/Edge safety mode: palette and previews were deferred.",
  largeModelComputationsDeferredTitle: "Large model parsed safely",
  largeModelComputationsDeferredText:
    "Chrome/Edge can crash while the app immediately builds palette data and preview images after parsing large OBJ files. The model statistics are available, but palette generation and previews are paused. Start the next step manually to verify whether the crash happens during post-processing rather than parsing.",
  startLargeModelComputations: "Start palette and preview calculation",
  largeModelComputationsStarted: "Large-model post-processing started...",
  error: "Error",
  tipBrightness:
    "Adds or removes lightness from all model colours before palette reduction. Changes are only applied when you click Apply.",
  tipContrast:
    "Increases or decreases the difference between light and dark colour areas before palette reduction.",
  tipSaturation:
    "Controls colour intensity before palette reduction. Negative values make colours greyer; positive values make them stronger.",
  tipTemperature:
    "Shifts colours colder or warmer. Negative values are cooler/bluer; positive values are warmer/yellower-red.",
  tipHue:
    "Rotates hue relative to the existing model colours. 0 means unchanged; -180 and +180 produce the same complementary rotation.",
  tipTint:
    "Shifts the colour cast between green and magenta. Negative values are greener; positive values are more magenta.",
  tipGamma:
    "Changes midtone brightness. 1.0 means unchanged; lower values brighten midtones, higher values darken them.",
  tipApply:
    "Rebuilds adjusted colours, reduced palette, and WebGL preview from the current slider values.",
  tipResetAdjustments:
    "Resets the pending colour-adjustment sliders to neutral values. Click Apply afterwards to rebuild the preview.",
  tipModelOrientation:
    "Rotates the loaded model geometry. Use 90° rotations for coarse axis orientation and fine rotation for small angle corrections. Vertex colours are kept; preview, palette, print simulation and 3MF export use the oriented geometry.",
  tipApplyOrientation:
    "Applies this 90° rotation to the current model orientation and refits the preview.",
  tipFineRotation:
    "Applies the selected degree rotation around the chosen model axis. Use small values for fine alignment corrections.",
  tipSetCurrentOrientation:
    "Keeps the current model orientation as the active working orientation and clears the pending fine-rotation value.",
  tipResetOrientation:
    "Restores the loaded model to its original imported orientation and refits the preview.",
  tipMaxColours:
    "Maximum number of virtual target colours after palette reduction, up to 256. This is the reduced target palette; coarse recipe resolutions may map several target colours to fewer printable blends. This does not limit the number of physical extruder slots.",
  tipBlendStepPercent:
    "Controls which printable virtual-extruder recipes are generated. Non-equal-third recipes use PrusaSlicer-compatible 5% percentage steps or coarser multiples. The equal three-colour recipe is kept as exact 1:1:1 and displayed as 33/33/33.",
  tipAccentProtection:
    "Controls how strongly small but visually distinct accent colours are preserved through palette reduction, palette matching, virtual-mix selection and print simulation. Off favours maximum reduction. Balanced is the default. Strong reserves more chromatic accents and merges larger similar areas more readily.",
  tipVirtualMixPriority:
    "Controls the colour model and conservative hue/accent guards used while selecting printable virtual mixtures. The calibrated Prusa FDM mixer remains the base model instead of a simple RGB layer average.",
  tipMappingStrategy:
    "Controls how reduced target-palette colours are mapped to printable physical or virtual blends. Closest match minimizes individual colour error. Smooth transitions favours more continuous printable colours between neighbouring target tones. Hue-preserving penalizes wrong hue direction. Accent-preserving protects small saturated target colours during mapping.",
  tipVirtualPreviewLightness:
    "Adjusts only the displayed virtual-mix and print-simulation brightness. It does not change the reduced target palette, layer sequences or 3MF export. Darker modes now apply a stronger LAB lightness reduction because calibrated FDM prediction can appear too light in the browser preview.",
  tipPhysicalExtruders:
    "Number of physical filament slots available. Valid range: 3 to 8. Presets, template colours, manual hex colours and suggestions are cut to this number.",
  tipPhysicalColourSource:
    "Select where the physical extruder colours should come from: a preset, uploaded 3MF template, manual hex colours, or a suggestion based on an uploaded filament list.",
  tipPreset:
    "Predefined physical colour sets grouped as classic sets, gamut extensions, tone-smoothing extensions and pure grey-scale sets. Only presets with enough slots for the selected physical extruder count are shown. Selecting 5G, 4G or 3G prepares a greyscale colour adjustment; on very large models the preview update is deferred until Apply is clicked.",
  tipPresetBase:
    "Selects the base set of standard physical colours. Up to five extruders this is the complete preset. With six to eight extruders it is the foundation for an additional extension preset.",
  tipPresetExtension:
    "Selects how six to eight physical extruders are extended. Extend gamut adds saturated spot colours selected from colour theory. Smooth tone values adds grey values to reduce harsh light/dark jumps. The tooltip shows the resulting full colour list.",
  presetGroupClassic: "Classic base sets",
  presetGroupGamut: "Extend gamut",
  presetGroupTone: "Smooth tone values",
  presetGroupGreyscale: "Pure grey-scale sets",
  colourCyan: "Cyan",
  colourMagenta: "Magenta",
  colourYellow: "Yellow",
  colourWhite: "White",
  colourBlack: "Black",
  colourRed: "Red",
  colourGreen: "Green",
  colourBlue: "Blue",
  colourLightGrey: "Light Grey",
  colourGrey: "Grey",
  colourDarkGrey: "Dark Grey",
  extendedPresetNote:
    "6- to 8-slot presets are experimental extensions. Gamut extensions add saturated spot colours; tone-smoothing extensions add grey values to reduce harsh light/dark jumps. For real filament sets, the filament-list suggestion is usually the better choice.",
  presetNotAvailableForExtruderCount:
    "The selected preset has fewer colours than the configured physical extruder count. Select another preset, reduce the extruder count, or use Template, Manual, or Filament-list suggestion.",
  tipManualPhysicalColours:
    "Manual physical extruder colours as hex codes. Supported: #RRGGBB or #RRGGBBAA.",
  tipApplyPhysicalSettings:
    "Applies the staged physical extruder count, colour source, preset or manual hex colours and recalculates the virtual mixtures once.",
  tipResetPhysicalSettings:
    "Discards staged physical colour changes and restores the currently applied settings.",
  tipSuggestPhysicalColours:
    "Calculates a complete filament draft from the current mode and material filter. It does not affect print simulation or export until you apply the draft.",
  tipApplySuggestionDraft:
    "Applies the visible E-slot draft as the active physical colours and recalculates the virtual mixtures once.",
  tipResetSuggestionDraft:
    "Discards the visible filament-suggestion draft and restores the currently applied suggestion settings and E-slots.",
  tipView:
    "Sets the camera to a standard viewing direction: front, back, left, right, top or bottom.",
  tipPreviewMode:
    "Adjusted colours shows the colour-corrected source colours before palette reduction. Reduced palette shows the target palette colours before physical filament mixing. Print simulation shows the effective colours after physical extruder and layer-sequence mapping. The mode affects the WebGL preview.",
  tipDisplayMode:
    "Shaded uses lighting and normals for a more realistic 3D view. Flat colour shows the triangle colours without lighting influence.",
  tipBackground:
    "Changes only the preview background. Auto follows the GUI theme. It does not affect the model colours or exported data.",
  tipWireframe:
    "Overlays triangle edges. Useful for checking tessellation, mesh density, and colour assignment boundaries.",
  tipAxes: "Shows a small coordinate axes helper in the 3D view.",
  tipWebglPreviewLod:
    "Preview-only triangle reduction. Full keeps all triangles. The other modes remove the smallest triangle-area quantiles: very small, small, or medium triangles. Export and colour segmentation remain unchanged.",
  tipRebuildPreview:
    "Disposes the current WebGL preview and builds it again. Use this if the preview becomes stale, slow, or visually inconsistent after several loads.",
  tipReloadData:
    "Clears parsed model data, palette, preview geometry and runtime caches, then reloads the currently selected OBJ, template and filament-list files from the browser File objects. Use this if the app becomes sluggish after repeated processing.",
  tipReloadApp:
    "Clears runtime caches and reloads the page with a cache-busting refresh parameter. This is the strongest browser-side reset available in a GitHub Pages build; unsaved work is lost.",
  previewRebuildRequested: "Preview rebuild requested.",
  reloadingData: "Reloading current data...",
  dataReloaded: "Current data reloaded from the selected files.",
  noReloadableData:
    "No OBJ file is available for reloading. Select and load files first.",
  tipFitToModel:
    "Fits the current model into the visible preview area without changing the selected colour mode.",
  tipResetView:
    "Resets rotation, zoom, and camera position to the selected standard view.",
  tipDownloadPaletteCsv:
    "Downloads the reduced virtual colour palette with index, hex colour, and triangle count.",
  tipDownloadSuggestionCsv:
    "Downloads the current physical extruder colours as CSV. For preset/template/manual sources this exports the fixed current colours; for filament-list mode it exports the calculated suggestion.",
  tipSaveSettings:
    "Downloads the selected project contents as JSON. Depending on the selected checkboxes, the file can embed the current OBJ model, 3MF template and filament list.",

  settingsTabs: "Workflow pages",
  resizeSettingsPanel:
    "Drag to resize the workflow panel. Double-click to reset the width.",
  tabModel: "Model",
  tabLoad: "Load",
  tabColourAdjustment: "Colour correction",
  tabPalette: "Palette",
  tabTemplate: "3MF template",
  tabPhysicalColours: "Physical colours",
  colourSetup: "Colour setup",
  tabFilamentSuggestion: "Filament suggestion",
  tabExport: "Export",
  tabSettings: "Project data",
  template3mf: "3MF template",
  templateIndependentNote:
    "Load the PrusaSlicer 3MF template independently from the physical colour source. Its profiles, bed size and physical colours can later be used for export or as one possible colour source.",
  slic3rConfigFound: "Slic3r_PE.config found",
  slic3rConfigMissing: "Slic3r_PE.config not found",
  fullSpectrumFound: "Full Spectrum JSON found",
  fullSpectrumMissing: "Full Spectrum JSON not found",
  physicalColours: "Physical colours",
  usingLoadedTemplateColours:
    "The physical slots use the colours from the loaded 3MF template.",
  loadTemplateFirst:
    "Load a 3MF template first, or choose another colour source.",
  usingCalculatedSuggestion:
    "The active physical slots use the applied filament-list suggestion.",
  usingManualFilamentSelection:
    "The physical slots use the slot assignment from the filament list.",
  manualFilamentSelectionResult: "Manual selection from filament list",
  calculateSuggestionFirst:
    "Load a filament list and click Calculate suggestion. The draft E-slots can then be reviewed, edited manually and applied.",
  applySuggestionDraftFirst:
    "A complete filament draft is available. Apply the draft to use it as active physical colours.",
  filamentSuggestion: "Filament suggestion",
  filamentListFileOnlyNote:
    "No filament colours are preloaded. Upload a filament colour list to enable suggestions.",
  filamentListFormatTitle: "Filament list format",
  filamentListFormatText:
    "Use a semicolon-separated CSV or TXT file. Recommended column order:",
  filamentListColumn1: "Name",
  filamentListColumn2: "Material",
  filamentListColumn3: "Hex colour",
  filamentListColumn1Help: "Filament name, manufacturer and colour name",
  filamentListColumn2Help:
    "Optional material type, for example PLA, PETG, ASA or TPU",
  filamentListColumn3Help: "#RRGGBB or #RRGGBBAA",
  filamentListFormatExample:
    "Prusament PLA Galaxy Black; PLA; #1A1A1A\nPrusament PLA Lipstick Red; PLA; #C20019\nPrusament PLA Pineapple Yellow; PLA; #EABD00",
  filamentListFormatNotes:
    "Lines starting with # are ignored. The parser also accepts files where the hex colour appears in another semicolon-separated column, but the format above is recommended.",
  filamentSuggestionLockedNote:
    "The entire filament suggestion section is locked because the physical colour source is not set to Filament list suggestion. Change the colour source above to use this section.",
  filamentSuggestionCombinedNote:
    "Prepare a draft E-slot assignment from the loaded filament list. Mode, material filter and manual slot edits do not affect print simulation or export until the draft is applied.",
  loadFilamentListInLoadTab: "Load a filament list on the Load page first.",
  suggestionMode: "Suggestion mode",
  suggestionBalanced: "Natural / balanced",
  suggestionDominant: "Dominant model colours",
  suggestionWide: "Broader mixing basis",
  suggestionExpert: "Expert settings",
  expertSettings: "Expert settings",
  saturationPenalty: "Saturation penalty",
  diversityPenalty: "Diversity penalty",
  balanceWeight: "Balance weight",
  weightExponent: "Weight exponent",
  neutralAnchor: "Neutral anchor",
  maxComponents: "Max. components",
  paletteColoursGenerated: "palette colours generated",
  noPaletteYet: "No palette calculated yet.",
  unappliedPaletteChanges:
    "Virtual-colour settings are pending. Click Apply to rebuild the reduced palette, layer sequences and preview.",
  applyingPaletteSettings: "Applying virtual-colour settings...",
  appliedPaletteSettings: "Virtual-colour settings applied.",
  tipApplyPaletteSettings:
    "Rebuilds the reduced virtual-colour palette, effective layer sequences and WebGL preview from the current virtual-colour settings. This is applied manually to avoid blocking large models while editing.",
  tipResetPaletteSettings:
    "Resets pending virtual-colour, mixing-step, accent-preservation, virtual-mix-priority and mapping-strategy settings to the last applied values.",
  export: "Export",
  exportIntro:
    "Generate a PrusaSlicer 3MF project from the prepared model, palette and physical colour setup. Template settings are used when a 3MF template is loaded; otherwise the app creates a minimal project.",
  export3mfProject: "PrusaSlicer 3MF project",
  outputFileName: "Output file name",
  exportFileNamePlaceholder: "Generated after model load",
  tipExportFileName:
    "Name of the generated 3MF project file. The file is downloaded by the browser.",
  exportUsesTemplate:
    "The export uses this template as source for PrusaSlicer project settings, wipe-tower information, thumbnail and bed size.",
  exportWithoutTemplateWarning:
    "No template is loaded. A minimal 3MF project can be generated, but for real slicing a configured PrusaSlicer template is recommended.",
  geometryAndBed: "Geometry and print bed",
  coordinateMode: "Coordinate mode",
  tipExportCoordinateMode:
    "auto detects Blender-style Y-up OBJ exports. keep preserves OBJ coordinates. blender-y-up forces X/Y/Z conversion for Blender OBJ exports. The WebGL preview uses the same orientation as the export.",
  scale: "Scale",
  tipExportScale:
    "Scale factor applied in the 3MF build transform. Ignored when target height is set.",
  targetHeight: "Target height",
  tipExportTargetHeight:
    "Optional final model height in millimetres after orientation. Leave empty to use scale.",
  optional: "optional",
  putOnBed: "Put on bed",
  tipExportPutOnBed:
    "Moves the transformed model so its lowest Z point is placed at Z=0.",
  centerOnBed: "Centre on bed",
  tipExportCenterOnBed:
    "Centres the transformed model on the selected print-bed size.",
  bedSource: "Bed source",
  fromTemplate: "From template",
  customBedSize: "Custom bed size",
  tipExportBedSource:
    "Use the bed size read from the 3MF template when available, or enter a custom bed size.",
  tipExportBedSize:
    "Custom bed size in millimetres. Used only when Custom bed size is selected.",
  defaultExtruder: "Default extruder",
  tipExportDefaultExtruder:
    "Object fallback extruder stored in Slic3r_PE_model.config. Painted triangles use the generated MMU segmentation.",
  export3mf: "Export 3MF",
  exporting3mf: "Exporting 3MF...",
  tipExport3mf:
    "Creates a PrusaSlicer 3MF project with Full Spectrum virtual extruders and triangle MMU segmentation. Open it in PrusaSlicer with File → Open Project.",
  csvExports: "CSV exports",
  export3mfNote:
    "Open the generated 3MF in PrusaSlicer with File → Open Project, not as plain geometry import. If a template is loaded, its PrusaSlicer project settings are used as the export basis.",
  export3mfDone: "3MF export generated:",
  virtualExtrudersShort: "virtual extruders",
  tipObjFile:
    "Load an OBJ file whose vertex lines contain colours in the form v x y z r g b.",
  tipSuggestionMode:
    "Controls the colour-suggestion strategy. Balanced is the default. Dominant follows large model colour regions more strongly. Broader mixing basis favours more distinct physical colours. Expert enables manual weights. The suggestion is set-based: it scores how well the chosen filaments can mix the full palette together.",
  tipFilamentSuggestionLocked:
    "This part of the filament suggestion section is locked until Physical colours → Colour source is set to Filament list suggestion.",
  tipSuggestionExpert:
    "Advanced controls for the physical-filament suggestion. These values affect only which physical colours are suggested, not the model colours.",
  tipSaturationPenalty:
    "Penalizes overly saturated candidate filaments. Higher values reduce the chance that very strong colours dominate the suggestion.",
  tipDiversityPenalty:
    "Penalizes filaments that are too similar to already selected slots. Higher values favour a broader, more distinct physical colour set.",
  tipBalanceWeight:
    "Blends area-weighted scoring with uniform palette coverage. 0 follows large colour regions; 1 gives all palette colours equal influence.",
  tipWeightExponent:
    "Reduces or increases the dominance of large colour regions before balancing. 1.0 is area-proportional; lower values give rare colours more influence.",
  tipNeutralAnchor:
    "Favours at least one mid-neutral filament when the reduced palette contains many muted or greyish colours. 0 disables the neutral anchor.",
  tipSuggestionMaxComponents:
    "Maximum number of physical filaments that may be mixed for one virtual colour during suggestion scoring. This should normally match the virtual-extruder component limit.",
  layerSequencePlan: "Layer-sequence-aware virtual extruders",
  paletteColours: "Palette colours",
  virtualBlends: "Effective virtual blends",
  physicalOnlyColours: "Physical-only colours",
  averageMappingError: "Average mapping error",
  worstMappingError: "Worst mapping error",
  poorMatches: "Poor matches",
  collapsedTargetColours: "Collapsed target colours",
  tipMappingDiagnostics:
    "Perceptual LAB diagnostics for mapping the reduced target palette to printable physical and virtual blends. High values usually mean that the selected physical colours or coarse mixing step cannot represent parts of the palette well.",
  moreVirtualBlends: "more virtual blends",
  noLayerSequencePlan:
    "Load a model and select physical colours to calculate effective layer sequences.",
  virtualPlanFilter: "Filter",
  filterAllAssignments: "All assignments",
  filterVirtualOnly: "Only effective virtual extruders",
  filterPhysicalOnly: "Only direct physical colours",
  filterMergedOnly: "Only merged palette colours",
  effectiveVirtualExtruders: "Effective virtual extruders",
  physicalDirectAssignments: "Direct physical assignments",
  mergedPaletteColours: "merged palette colours",
  paletteColour: "Palette colour",
  trianglesShort: "triangles",
  moreRows: "more rows",
  noVirtualPlanRows: "No rows match the selected filter.",
  downloadVirtualExtruderCsv: "Download virtual extruder CSV",
  tipLayerSequencePlan:
    "The reduced palette is converted to effective layer sequences. Component ratios are first snapped to the selected mixing step. Ratios that produce the same repeating filament sequence are merged. 100% colours are assigned to the physical extruder instead of becoming virtual extruders.",
  tipVirtualPlanFilter:
    "Filters the layer-sequence plan. Effective virtual extruders are real mixed sequences. Direct physical colours are 100% one filament. Merged rows show where several palette colours lead to the same layer sequence.",
  tipDownloadVirtualExtruderCsv:
    "Downloads the effective virtual-extruder plan after layer-sequence quantisation, including physical-only colours and repeated layer sequences.",
  paletteColourDistribution: "Reduced target palette",
  effectiveMixDistribution: "Effective mixing distribution",
  tipPaletteBlockmap:
    "Shows the reduced target palette as weighted blocks. Block size follows the number of model triangles. Colours are sorted by spectrum; neutral colours are grouped at the end.",
  tipEffectiveMixBlockmap:
    "Shows the effective virtual and direct physical assignments as weighted blocks. Click blocks to select the corresponding virtual extruder or direct physical assignment for editing.",
  paletteSortedBySpectrum: "sorted by spectrum, neutrals last",
  mergeSelectedTitle: "Merge selected virtual colours",
  mergeSelectedDescription:
    "Combines the selected palette colours into the first selected assignment. This reduces the number of effective virtual extruders.",
  assignSelectedTitle: "Assign selected colours to a physical extruder",
  assignSelectedDescription:
    "Bypasses virtual mixing and maps the selected palette colours directly to E1, E2, etc.",
  noVirtualEditOverrides: "No manual edits active.",

  stagedLoadIntro:
    "Load or replace the OBJ model, 3MF template and filament list independently. When a baked OBJ was sent from Texture Baking, you can still add or replace the 3MF template and filament list here.",
  optionalFile: "optional",
  loadSelectedFiles: "Load selected inputs",
  tipLoadSelectedFiles:
    "Loads all selected inputs in one controlled step: 3MF template, filament list and OBJ model. After loading, the app switches to Physical colours.",
  loadingSelectedFiles: "Loading selected files...",
  selectedFilesLoaded: "Selected inputs loaded.",
  currentLoadedInputs: "Currently loaded inputs",
  progressLoadTitle: "Load inputs",
  progressLoadCollectFiles: "Check selected files",
  progressLoadTemplate: "Read 3MF template",
  progressLoadFilaments: "Read filament list",
  progressLoadObj: "Parse OBJ vertex colours",
  progressLoadPostProcess: "Prepare model data",
  progressPaletteTitle: "Recalculate virtual colours",
  progressPaletteApplySettings: "Apply settings",
  progressPaletteBuildPalette: "Build reduced palette",
  progressPaletteBuildSequences: "Build virtual extruders",
  progressPaletteRefreshPreview: "Refresh preview",
  progressPreviewTitle: "Update preview",
  progressPreviewApplySettings: "Apply preview settings",
  progressPreviewRebuild: "Rebuild preview",
  progressPreviewDone: "Preview updated",
  progress3dTitle: "Build 3D preview",
  progress3dActivate: "Activate 3D preview",
  progress3dPrepareGeometry: "Prepare preview geometry",
  progress3dBuildView: "Build WebGL view",
  progressVirtualEditTitle: "Update virtual extruders",
  progressVirtualEditApply: "Apply manual edit",
  progressVirtualEditRecalculate: "Recalculate effective assignments",
  progressVirtualEditRefresh: "Refresh preview data",
  progressSuggestionTitle: "Calculate/apply filament suggestion",
  progressSuggestionApplySettings: "Apply suggestion settings",
  progressSuggestionScoreFilaments: "Score filtered filaments",
  progressSuggestionApplySlots: "Apply physical E-slots",
  progressSuggestionRefreshVirtuals: "Refresh virtual mixtures",
  suggestionRecalculated: "Filament suggestion recalculated.",
  virtualColoursRecalculated: "Virtual colours recalculated.",
  progressExportTitle: "Export 3MF",
  progressExportPrepareGeometry: "Prepare geometry",
  progressExportWriteSegmentation: "Write MMU segmentation",
  progressExportBuild3mf: "Build 3MF project",
  progressExportDownload: "Prepare download",
  virtualEditor: "Edit virtual extruders",
  selectedPaletteColours: "selected palette colours",
  mergeSelected: "Merge selected",
  assignSelectedToPhysical: "Assign to physical",
  resetVirtualEdits: "Reset edits",
  virtualEditOverridesActive: "manual virtual-extruder edits active",
  selectAssignmentRow: "Select this assignment row for manual editing.",
  virtualAssignmentsMerged:
    "Selected virtual-extruder assignments were merged.",
  virtualAssignmentsAssignedPhysical:
    "Selected palette colours were assigned to a physical extruder.",
  virtualAssignmentsReset: "Manual virtual-extruder edits were reset.",
  tipVirtualEdit:
    "Select assignment rows to merge their palette colours into one existing virtual extruder, or assign them directly to a physical extruder. The 3MF export uses these edits.",
  tipMergeSelectedVirtuals:
    "Merges the selected palette colours into the first selected assignment. Useful for reducing similar virtual extruders.",
  tipAssignSelectedPhysical:
    "Assigns all selected palette colours directly to the chosen physical extruder, bypassing virtual mixing.",
  tipResetVirtualEdits:
    "Removes all manual merge and physical-extruder overrides.",
  githubPagesNote:
    "This web build runs fully in the browser. 3MF export and template-based project writing are the next module.",
};

export type Lang = "en";
export function getDict(_lang: Lang = "en"): Dict {
  return en;
}
