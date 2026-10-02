"""Pydantic schemas for API request/response validation."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Generic
# ---------------------------------------------------------------------------
class ErrorResponse(BaseModel):
    """Standard error response (RFC 9457-ish)."""
    type: str = "about:blank"
    title: str
    detail: Optional[str] = None
    status: int = 400
    instance: Optional[str] = None


class HealthCheckResponse(BaseModel):
    status: str = "ok"
    version: str = "1.0.0"
    database: str = "connected"


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=200)


class LoginResponse(BaseModel):
    user_id: int
    display_name: str
    token: str
    expires_at: Optional[datetime] = None


class UserResponse(BaseModel):
    id: int
    display_name: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class LogoutResponse(BaseModel):
    message: str = "Logged out"


# ---------------------------------------------------------------------------
# Experiment
# ---------------------------------------------------------------------------
class ExperimentMetadata(BaseModel):
    id: int
    file_name: str
    sample_name: Optional[str] = None
    solvent_name: Optional[str] = None
    operator_name: Optional[str] = None
    collection_time: Optional[datetime] = None
    processing_time: Optional[datetime] = None
    astra_version: Optional[str] = None
    file_size: Optional[int] = None
    file_hash: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    version: int = 1

    class Config:
        from_attributes = True


class PeakResponse(BaseModel):
    """Single peak within an experiment."""
    id: int
    range_number: Optional[int] = None
    range_name: Optional[str] = None
    range_start: Optional[float] = None
    range_end: Optional[float] = None
    dn_dc: Optional[float] = None
    uv_extinction: Optional[float] = None
    concentration: Optional[float] = None
    injected_mass: Optional[float] = None
    real_ri: Optional[float] = None
    ls_model: Optional[Any] = None
    ls_fit_degree: Optional[Any] = None
    radius_type: Optional[Any] = None
    a2: Optional[float] = None
    mn: Optional[float] = None
    mw: Optional[float] = None
    mz: Optional[float] = None
    polydispersity: Optional[float] = None
    rms_radius: Optional[float] = None
    peak_area: Optional[float] = None
    recovery: Optional[float] = None
    is_auto: Optional[bool] = None
    version: int = 1
    created_at: Optional[datetime] = None
    warnings: list[str] = []

    class Config:
        from_attributes = True


class PeakCreate(BaseModel):
    range_start: float
    range_end: float
    range_number: Optional[int] = None
    range_name: Optional[str] = None
    dn_dc: Optional[float] = None
    uv_extinction: Optional[float] = None
    concentration: Optional[float] = None
    injected_mass: Optional[float] = None
    real_ri: Optional[float] = None
    ls_model: Optional[int] = None
    ls_fit_degree: Optional[int] = None
    radius_type: Optional[int] = None
    a2: Optional[float] = None
    is_auto: bool = False

    @field_validator("ls_model")
    @classmethod
    def _validate_ls_model(cls, v):
        if v is None:
            return v
        if v not in (0, 1, 2):
            raise ValueError("ls_model must be 0 (Zimm), 1 (Debye), or 2 (Berry)")
        return v

    @field_validator("ls_fit_degree")
    @classmethod
    def _validate_ls_fit_degree(cls, v):
        if v is None:
            return v
        if v not in (1, 2):
            raise ValueError("ls_fit_degree must be 1 or 2")
        return v


class PeakUpdate(BaseModel):
    range_start: Optional[float] = None
    range_end: Optional[float] = None
    range_number: Optional[int] = None
    range_name: Optional[str] = None
    dn_dc: Optional[float] = None
    uv_extinction: Optional[float] = None
    concentration: Optional[float] = None
    injected_mass: Optional[float] = None
    real_ri: Optional[float] = None
    ls_model: Optional[int] = None
    ls_fit_degree: Optional[int] = None
    radius_type: Optional[int] = None
    a2: Optional[float] = None
    is_auto: Optional[bool] = None

    @field_validator("ls_model")
    @classmethod
    def _validate_ls_model(cls, v):
        if v is None:
            return v
        if v not in (0, 1, 2):
            raise ValueError("ls_model must be 0 (Zimm), 1 (Debye), or 2 (Berry)")
        return v

    @field_validator("ls_fit_degree")
    @classmethod
    def _validate_ls_fit_degree(cls, v):
        if v is None:
            return v
        if v not in (1, 2):
            raise ValueError("ls_fit_degree must be 1 or 2")
        return v


class PeakListResponse(BaseModel):
    peaks: list[PeakResponse]
    total: int


class AutoPeakRequest(BaseModel):
    detector: Optional[str] = None
    threshold: Optional[float] = None
    baseline_percent: float = Field(2.0, gt=0, le=50)
    min_peak_width: float = Field(0.05, gt=0)


class AutoPeakResponse(BaseModel):
    peaks: list[PeakResponse]
    message: str = "Auto-peak detection complete"


class DnDcLibraryEntry(BaseModel):
    polymer: str
    solvent: str
    dn_dc: float
    source: str = ""
    notes: str = ""


class DnDcLibraryResponse(BaseModel):
    entries: list[DnDcLibraryEntry]
    total: int


class ExperimentResponse(BaseModel):
    """Full experiment record including all JSON config fields."""
    id: int
    file_name: str
    original_path: Optional[str] = None
    file_size: Optional[int] = None
    file_hash: Optional[str] = None

    sample_name: Optional[str] = None
    solvent_name: Optional[str] = None
    solvent_description: Optional[str] = None
    operator_name: Optional[str] = None
    collection_time: Optional[datetime] = None
    processing_time: Optional[datetime] = None
    astra_version: Optional[str] = None

    mals_config: Optional[Any] = None
    ri_config: Optional[Any] = None
    uv_config: Optional[Any] = None
    viscometer_config: Optional[Any] = None
    sample_config: Optional[Any] = None
    fluid_path: Optional[Any] = None

    peaks: list[PeakResponse] = []

    raw_data_path: Optional[str] = None
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    version: int = 1

    class Config:
        from_attributes = True


class ExperimentListResponse(BaseModel):
    experiments: list[ExperimentMetadata]
    total: int
    page: int
    limit: int
    pages: int


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
class UploadResponse(BaseModel):
    experiment_id: int
    file_name: str
    file_size: int
    file_hash: str
    sample_name: Optional[str] = None
    message: str = "File uploaded and parsed successfully"


# ---------------------------------------------------------------------------
# Chromatogram
# ---------------------------------------------------------------------------
class DetectorInfo(BaseModel):
    code: str
    name: str
    enabled: bool = True
    angles: Optional[list[float]] = None
    wavelengths: Optional[list[float]] = None
    num_detectors: Optional[int] = None
    instrument_class: Optional[str] = None


class DetectorListResponse(BaseModel):
    detectors: list[DetectorInfo]


class ChromatogramResponse(BaseModel):
    """Chromatogram data for a single detector or all detectors."""
    time: Optional[list[float]] = None
    detectors: Optional[dict[str, Any]] = None
    downsampled: bool = False
    downsample_factor: Optional[int] = None
    point_count: Optional[int] = None
    baseline_subtracted: bool = False


# ---------------------------------------------------------------------------
# Baselines
# ---------------------------------------------------------------------------
class BaselineResponse(BaseModel):
    id: int
    experiment_id: int
    detector_name: Optional[str] = None
    detector_class: Optional[str] = None
    baseline_type: Optional[int] = None
    x1: Optional[float] = None
    x2: Optional[float] = None
    y1: Optional[float] = None
    y2: Optional[float] = None
    slope: Optional[float] = None
    intercept: Optional[float] = None
    std_dev: Optional[float] = None
    is_auto: Optional[bool] = None
    version: int = 1
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class BaselineCreate(BaseModel):
    detector_name: str
    detector_class: Optional[str] = None
    baseline_type: int = Field(..., ge=0, le=2)
    x1: Optional[float] = None
    x2: Optional[float] = None
    y1: Optional[float] = None
    y2: Optional[float] = None
    is_auto: bool = False


class BaselineUpdate(BaseModel):
    baseline_type: Optional[int] = Field(None, ge=0, le=2)
    x1: Optional[float] = None
    x2: Optional[float] = None
    y1: Optional[float] = None
    y2: Optional[float] = None
    is_auto: Optional[bool] = None


class BaselineListResponse(BaseModel):
    baselines: list[BaselineResponse]
    total: int


class AutoBaselineRequest(BaseModel):
    width_std_dev: float = Field(3.0, gt=0)
    num_passes: int = Field(1, ge=1, le=10)


class AutoBaselineResponse(BaseModel):
    baselines: list[BaselineResponse]
    message: str = "Auto-baseline computed"


class BlankSubtractRequest(BaseModel):
    blank_experiment_id: int


class BlankSubtractResponse(BaseModel):
    message: str
    blank_experiment_id: int


# ---------------------------------------------------------------------------
# Procedures
# ---------------------------------------------------------------------------
class ProcedureStateResponse(BaseModel):
    """Single procedure state within an experiment."""
    id: int
    experiment_id: int
    procedure_name: Optional[str] = None
    procedure_order: Optional[int] = None
    is_enabled: bool = True
    has_been_run: bool = False
    parameters: Optional[Any] = None
    version: int = 1
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ProcedureListResponse(BaseModel):
    procedures: list[ProcedureStateResponse]
    total: int


class ProcedureUpdateRequest(BaseModel):
    is_enabled: Optional[bool] = None
    parameters: Optional[dict] = None
    has_been_run: Optional[bool] = None


class ProcedureRunRequest(BaseModel):
    peak_id: Optional[int] = None


class AutoAnalyzeResponse(BaseModel):
    experiment_id: int
    peaks: list[PeakResponse] = []
    procedure_states: list[ProcedureStateResponse] = []
    message: str = "Auto-analysis complete"


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------
class PeakResultsResponse(BaseModel):
    """Per-peak computed results."""
    peak_id: int
    range_number: Optional[int] = None
    range_name: Optional[str] = None
    range_start: Optional[float] = None
    range_end: Optional[float] = None
    mn: Optional[float] = None
    mw: Optional[float] = None
    mz: Optional[float] = None
    polydispersity: Optional[float] = None
    rms_radius: Optional[float] = None
    peak_area: Optional[float] = None
    recovery: Optional[float] = None
    version: int = 1

    class Config:
        from_attributes = True


class MomentsResponse(BaseModel):
    """Moments (Mn, Mw, Mz, Pd) for all peaks."""
    peaks: list[PeakResultsResponse]
    total: int


class MolarMassSliceResponse(BaseModel):
    """Per-slice molar-mass data for a single peak."""
    peak_id: int
    time: list[Optional[float]] = []
    molar_mass: list[Optional[float]] = []
    concentration: list[Optional[float]] = []
    fit_model: Optional[str] = None
    fit_degree: Optional[int] = None


class MolarMassResponse(BaseModel):
    """M(v) slice data for all peaks (or a single peak if filtered)."""
    peaks: list[MolarMassSliceResponse]
    total: int


class RadiusSliceResponse(BaseModel):
    """Per-slice radius data for a single peak."""
    peak_id: int
    time: list[Optional[float]] = []
    radius: list[Optional[float]] = []
    concentration: list[Optional[float]] = []


class RadiusResponse(BaseModel):
    """Rg(v) slice data for all peaks (or a single peak if filtered)."""
    peaks: list[RadiusSliceResponse]
    total: int


class DistributionResponse(BaseModel):
    """Binned molar-mass distribution for a peak."""
    peak_id: int
    bin_centers: list[Optional[float]] = []
    weights: list[Optional[float]] = []
    bin_edges: list[Optional[float]] = []
    distribution_type: str = "diff"
    n_bins: int = 50
    cumulative: list[Optional[float]] = []
    bandwidth: Optional[float] = None
    kernel: Optional[str] = None
    method: Optional[str] = None


class AngularFitSliceResponse(BaseModel):
    """Per-slice angular fit quality metrics for a single peak."""
    peak_id: int
    time: list[Optional[float]] = []
    chi2: list[Optional[float]] = []
    n_angles_used: list[Optional[int]] = []
    fit_model: Optional[str] = None
    fit_degree: Optional[int] = None


class AngularFitResponse(BaseModel):
    """Angular fit quality metrics for all peaks."""
    peaks: list[AngularFitSliceResponse]
    total: int


class ResultsResponse(BaseModel):
    """Aggregate results: peaks + slice data summary."""
    experiment_id: int
    peaks: list[PeakResultsResponse]
    has_slice_data: bool = False
    message: str = "Results available"


# ---------------------------------------------------------------------------
# Phase 4 advanced analysis
# ---------------------------------------------------------------------------
class ConformationSliceResponse(BaseModel):
    """Conformation plot (log Rg vs log M) for a single peak."""
    peak_id: int
    log_m: list[Optional[float]] = []
    log_rg: list[Optional[float]] = []
    slope: Optional[float] = None
    intercept: Optional[float] = None
    r_squared: Optional[float] = None
    n_points: Optional[int] = None
    conformation_class: Optional[str] = None


class ConformationResponse(BaseModel):
    """Conformation results for all peaks."""
    peaks: list[ConformationSliceResponse]
    total: int


class ConjugateSliceResponse(BaseModel):
    """Protein conjugate / copolymer per-slice results for a single peak."""
    peak_id: int
    time: list[Optional[float]] = []
    total_molar_mass: list[Optional[float]] = []
    protein_fraction: list[Optional[float]] = []
    modifier_fraction: list[Optional[float]] = []
    protein_molar_mass: list[Optional[float]] = []
    modifier_molar_mass: list[Optional[float]] = []


class ConjugateResponse(BaseModel):
    """Protein conjugate / copolymer results for all peaks."""
    peaks: list[ConjugateSliceResponse]
    total: int


class BranchingSliceResponse(BaseModel):
    """Polymer branching per-slice results for a single peak."""
    peak_id: int
    molar_mass: list[Optional[float]] = []
    branching_ratio_g: list[Optional[float]] = []
    branch_units_per_molecule: list[Optional[float]] = []
    long_chain_branch_freq: list[Optional[float]] = []
    branching_type: Optional[str] = None


class BranchingResponse(BaseModel):
    """Polymer branching results for all peaks."""
    peaks: list[BranchingSliceResponse]
    total: int


class ViscometrySliceResponse(BaseModel):
    """Viscometry per-slice results for a single peak."""
    peak_id: int
    time: list[Optional[float]] = []
    intrinsic_viscosity: list[Optional[float]] = []
    specific_viscosity: list[Optional[float]] = []
    hydrodynamic_radius: list[Optional[float]] = []
    universal_molar_mass: list[Optional[float]] = []


class ViscometryResponse(BaseModel):
    """Viscometry results for all peaks, including MHS constants."""
    peaks: list[ViscometrySliceResponse]
    total: int
    mhs_K: Optional[float] = None
    mhs_a: Optional[float] = None
    mhs_r_squared: Optional[float] = None


class CalibrationResponse(BaseModel):
    """Column calibration curve fit results."""
    elution_volume: list[Optional[float]] = []
    log_m: list[Optional[float]] = []
    fit_log_m: list[Optional[float]] = []
    coefficients: list[Optional[float]] = []
    r_squared: Optional[float] = None
    calibration_type: Optional[str] = None


class ParticleSliceResponse(BaseModel):
    """Particle number-density per-slice results for a single peak."""
    peak_id: int
    molar_mass: list[Optional[float]] = []
    geometric_radius: list[Optional[float]] = []
    number_density: list[Optional[float]] = []
    number_fraction: list[Optional[float]] = []
    total_count: Optional[float] = None


class ParticleResponse(BaseModel):
    """Particle number-density results for all peaks."""
    peaks: list[ParticleSliceResponse]
    total: int


class PeakStatisticsResponse(BaseModel):
    """Chromatographic peak statistics for a single peak."""
    peak_id: int
    retention_time: Optional[float] = None
    peak_max: Optional[float] = None
    width_baseline: Optional[float] = None
    width_half_height: Optional[float] = None
    asymmetry_factor: Optional[float] = None
    tailing_factor: Optional[float] = None
    plate_count: Optional[float] = None
    resolution: Optional[float] = None


class PeakStatisticsListResponse(BaseModel):
    """Peak statistics for all peaks."""
    peaks: list[PeakStatisticsResponse]
    total: int


class DnDcDeterminationResponse(BaseModel):
    """dn/dc determination result."""
    dn_dc_value: Optional[float] = None
    method: Optional[str] = None
    message: Optional[str] = None


class ErrorAnalysisResponse(BaseModel):
    """Error analysis and uncertainty propagation for a single peak."""
    peak_id: int
    molar_mass_uncertainty: list[Optional[float]] = []
    concentration_uncertainty: list[Optional[float]] = []
    snr: Optional[float] = None
    reduced_chi2: Optional[float] = None
    r_squared: Optional[float] = None


# ---------------------------------------------------------------------------
# Phase 5 — Reporting & Export
# ---------------------------------------------------------------------------
class ReportTemplateResponse(BaseModel):
    """A saved report template."""
    id: int
    name: str
    template_config: Optional[str] = None
    is_default: bool = False
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ReportTemplateListResponse(BaseModel):
    """List of report templates."""
    templates: list[ReportTemplateResponse]
    total: int


class ReportTemplateCreate(BaseModel):
    """Create a new report template."""
    name: str = Field(..., min_length=1, max_length=200)
    template_config: Optional[str] = None
    is_default: bool = False


class ReportTemplateUpdate(BaseModel):
    """Update an existing report template."""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    template_config: Optional[str] = None
    is_default: Optional[bool] = None


class ReportGenerateRequest(BaseModel):
    """Request body for report generation."""
    format: str = Field("pdf", pattern="^(pdf|html|csv|xlsx)$")
    title: Optional[str] = None
    notes: Optional[str] = None
    include_slice_data: bool = True
    template_id: Optional[int] = None


class ReportJobResponse(BaseModel):
    """202 Accepted response with job ID for async report generation."""
    job_id: str
    status: str = "started"
    experiment_id: int


class ReportJobStatus(BaseModel):
    """Poll-able status for a report generation job."""
    job_id: str
    experiment_id: int
    status: str
    format: Optional[str] = None
    progress: int = 0
    message: Optional[str] = None
    error: Optional[str] = None
    file_path: Optional[str] = None
    file_size: Optional[int] = None


# ---------------------------------------------------------------------------
# Phase 6 — Batch & Automation
# ---------------------------------------------------------------------------
class MethodTemplateResponse(BaseModel):
    """A saved method template (reusable analysis settings)."""
    id: int
    name: str
    description: Optional[str] = None
    template: Optional[str] = None
    is_public: bool = False
    shared_with: Optional[str] = None
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class MethodTemplateListResponse(BaseModel):
    """List of method templates."""
    methods: list[MethodTemplateResponse]
    total: int


class MethodTemplateCreate(BaseModel):
    """Create a new method template."""
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    template: Optional[str] = None
    is_public: bool = False


class MethodTemplateUpdate(BaseModel):
    """Update an existing method template."""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    template: Optional[str] = None
    is_public: Optional[bool] = None


class BatchApplyRequest(BaseModel):
    """Request body for batch apply — propagate settings from source to targets."""
    source_experiment_id: int
    target_experiment_ids: list[int] = Field(..., min_length=1)
    settings_to_propagate: list[str] = Field(
        ..., min_length=1,
        description="Subset of: baselines, peaks, procedures, peak_params",
    )


class BatchJobResponse(BaseModel):
    """202 Accepted response with batch job ID."""
    job_id: str
    status: str = "started"
    source_experiment_id: int
    target_count: int


class BatchJobStatus(BaseModel):
    """Poll-able status for a batch job."""
    job_id: str
    source_experiment_id: int
    status: str
    progress: int = 0
    message: Optional[str] = None
    error: Optional[str] = None
    target_results: Optional[list[dict]] = None


class BatchJobListResponse(BaseModel):
    """List of batch jobs (history)."""
    jobs: list[BatchJobStatus]
    total: int


class EasiTableCreateRequest(BaseModel):
    """Create an EASI table from multiple experiments."""
    name: str = Field(..., min_length=1, max_length=200)
    experiment_ids: list[int] = Field(..., min_length=1)
    column_config: Optional[str] = None


class EasiTableResponse(BaseModel):
    """EASI table data — multi-run comparison."""
    id: int
    name: str
    experiment_ids: list[int] = []
    columns: list[str] = []
    rows: list[dict] = []
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class EasiTableListResponse(BaseModel):
    """List of EASI tables."""
    tables: list[EasiTableResponse]
    total: int


# ---------------------------------------------------------------------------
# Phase 7 — Advanced Export & Polish
# ---------------------------------------------------------------------------
class ExportOptions(BaseModel):
    """Options for .afe8 export (Phase 7).

    Controls which data categories are written back to the .afe8 file.
    If a category is True but no data exists for it, it is silently skipped.
    """
    include_baselines: bool = True
    include_peaks: bool = True
    include_results: bool = True
    include_procedures: bool = True


class SaveAsRequest(BaseModel):
    """Request body for 'Save As' — creates a copy of the experiment with modifications."""
    new_file_name: Optional[str] = None
    options: Optional[ExportOptions] = None


class ExportResultResponse(BaseModel):
    """Response metadata after an export operation."""
    path: str
    baselines_written: int = 0
    peaks_written: int = 0
    results_written: int = 0
    procedures_written: int = 0
    warnings: list[str] = []


# ---------------------------------------------------------------------------
# Phase 8 — Polish & Specialized
# ---------------------------------------------------------------------------
class A2Response(BaseModel):
    """Second virial coefficient (A2) analysis result."""
    a2: Optional[float] = None
    mw: Optional[float] = None
    rg: Optional[float] = None
    n_points: int = 0
    r_squared: Optional[float] = None
    fit_quality: Optional[str] = None
    method: Optional[str] = None


class ZimmPlotResponse(BaseModel):
    """Zimm plot data points and fit results."""
    x: list[float] = []
    y: list[float] = []
    angles: list[float] = []
    concentrations: list[float] = []
    k_scale: float = 0.0
    a2: Optional[float] = None
    mw: Optional[float] = None
    rg: Optional[float] = None


class BatchA2Request(BaseModel):
    """Request body for batch A2 determination."""
    concentrations: list[float] = Field(..., min_length=2)
    rayleigh_ratio_zero: list[float] = Field(..., min_length=2)
    optical_constant: float = Field(..., gt=0)


class BatchA2Response(BaseModel):
    """Batch A2 determination result."""
    a2: Optional[float] = None
    mw: Optional[float] = None
    slope: Optional[float] = None
    intercept: Optional[float] = None
    r_squared: Optional[float] = None
    n_points: int = 0


class AbsorptionCorrectionResponse(BaseModel):
    """Absorption correction result."""
    corrected_molar_mass: list[Optional[float]] = []
    transmittance: list[Optional[float]] = []
    correction_factor_mean: Optional[float] = None
    absorption_detected: bool = False
    message: Optional[str] = None


class AbsorptionCorrectionRequest(BaseModel):
    """Request body for absorption correction."""
    forward_monitor: list[float] = Field(..., min_length=1)
    time_axis: list[float] = Field(..., min_length=1)
    peak_start: float
    peak_end: float
    baseline_pct: float = 10.0


class BackupInfoResponse(BaseModel):
    """Information about a single backup file."""
    filename: str
    path: str
    size_bytes: int
    created_at: str


class BackupListResponse(BaseModel):
    """List of available backups."""
    backups: list[BackupInfoResponse]
    total: int


class BackupCreateResponse(BaseModel):
    """Response after creating a backup."""
    path: str
    size_bytes: int
    created_at: str


class IntegrityCheckResponse(BaseModel):
    """Database integrity check result."""
    status: str
    message: str
