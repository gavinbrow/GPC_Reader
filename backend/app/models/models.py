"""SQLAlchemy ORM models for all database tables."""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    session_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_active: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # Relationships
    experiments: Mapped[list["Experiment"]] = relationship(back_populates="user")
    sessions: Mapped[list["SessionRecord"]] = relationship(back_populates="user", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# Experiments
# ---------------------------------------------------------------------------
class Experiment(Base):
    __tablename__ = "experiments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    original_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Metadata extracted from .afe8
    sample_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    solvent_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    solvent_description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    operator_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    collection_time: Mapped[str | None] = mapped_column(String(100), nullable=True)
    processing_time: Mapped[str | None] = mapped_column(String(100), nullable=True)
    astra_version: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Instrument configs (JSON)
    mals_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    ri_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    uv_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    viscometer_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    sample_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    fluid_path: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Raw data reference
    raw_data_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    is_shared: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    version: Mapped[int] = mapped_column(Integer, default=1)

    # Relationships
    user: Mapped[User | None] = relationship(back_populates="experiments")
    baselines: Mapped[list["Baseline"]] = relationship(back_populates="experiment", cascade="all, delete-orphan")
    peaks: Mapped[list["Peak"]] = relationship(back_populates="experiment", cascade="all, delete-orphan")
    procedure_states: Mapped[list["ProcedureState"]] = relationship(back_populates="experiment", cascade="all, delete-orphan")
    computed_data: Mapped[list["ComputedData"]] = relationship(back_populates="experiment", cascade="all, delete-orphan")
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="experiment", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# Baselines
# ---------------------------------------------------------------------------
class Baseline(Base):
    __tablename__ = "baselines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), nullable=False)
    detector_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    detector_class: Mapped[str | None] = mapped_column(String(100), nullable=True)
    baseline_type: Mapped[int | None] = mapped_column(Integer, nullable=True)
    x1: Mapped[float | None] = mapped_column(Float, nullable=True)
    x2: Mapped[float | None] = mapped_column(Float, nullable=True)
    y1: Mapped[float | None] = mapped_column(Float, nullable=True)
    y2: Mapped[float | None] = mapped_column(Float, nullable=True)
    slope: Mapped[float | None] = mapped_column(Float, nullable=True)
    intercept: Mapped[float | None] = mapped_column(Float, nullable=True)
    std_dev: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_auto: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    experiment: Mapped[Experiment] = relationship(back_populates="baselines")


# ---------------------------------------------------------------------------
# Peaks
# ---------------------------------------------------------------------------
class Peak(Base):
    __tablename__ = "peaks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), nullable=False)
    range_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    range_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    range_start: Mapped[float | None] = mapped_column(Float, nullable=True)
    range_end: Mapped[float | None] = mapped_column(Float, nullable=True)
    range_type: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Sample parameters
    dn_dc: Mapped[float | None] = mapped_column(Float, nullable=True)
    uv_extinction: Mapped[float | None] = mapped_column(Float, nullable=True)
    concentration: Mapped[float | None] = mapped_column(Float, nullable=True)
    injected_mass: Mapped[float | None] = mapped_column(Float, nullable=True)
    real_ri: Mapped[float | None] = mapped_column(Float, nullable=True)

    # LS analysis parameters
    ls_model: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ls_fit_degree: Mapped[int | None] = mapped_column(Integer, nullable=True)
    radius_type: Mapped[int | None] = mapped_column(Integer, nullable=True)
    radius_seed: Mapped[float | None] = mapped_column(Float, nullable=True)
    a2: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Computed results
    mn: Mapped[float | None] = mapped_column(Float, nullable=True)
    mw: Mapped[float | None] = mapped_column(Float, nullable=True)
    mz: Mapped[float | None] = mapped_column(Float, nullable=True)
    polydispersity: Mapped[float | None] = mapped_column(Float, nullable=True)
    rms_radius: Mapped[float | None] = mapped_column(Float, nullable=True)
    peak_area: Mapped[float | None] = mapped_column(Float, nullable=True)
    recovery: Mapped[float | None] = mapped_column(Float, nullable=True)

    is_auto: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    experiment: Mapped[Experiment] = relationship(back_populates="peaks")
    computed_data: Mapped[list["ComputedData"]] = relationship(back_populates="peak", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# Procedure States
# ---------------------------------------------------------------------------
class ProcedureState(Base):
    __tablename__ = "procedure_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), nullable=False)
    procedure_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    procedure_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    has_been_run: Mapped[bool] = mapped_column(Boolean, default=False)
    parameters: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    experiment: Mapped[Experiment] = relationship(back_populates="procedure_states")


# ---------------------------------------------------------------------------
# Computed Data
# ---------------------------------------------------------------------------
class ComputedData(Base):
    __tablename__ = "computed_data"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), nullable=False)
    peak_id: Mapped[int | None] = mapped_column(ForeignKey("peaks.id", ondelete="CASCADE"), nullable=True)
    data_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    data_values: Mapped[str | None] = mapped_column(Text, nullable=True)
    uncertainties: Mapped[str | None] = mapped_column(Text, nullable=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    experiment: Mapped[Experiment] = relationship(back_populates="computed_data")
    peak: Mapped[Peak | None] = relationship(back_populates="computed_data")


# ---------------------------------------------------------------------------
# Report Templates
# ---------------------------------------------------------------------------
class ReportTemplate(Base):
    __tablename__ = "report_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    template_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Method Templates
# ---------------------------------------------------------------------------
class MethodTemplate(Base):
    __tablename__ = "method_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    template: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    shared_with: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Batch Jobs
# ---------------------------------------------------------------------------
class BatchJob(Base):
    __tablename__ = "batch_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    source_experiment_id: Mapped[int | None] = mapped_column(ForeignKey("experiments.id"), nullable=True)
    target_experiment_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    settings_to_propagate: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    progress_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ---------------------------------------------------------------------------
# EASI Tables
# ---------------------------------------------------------------------------
class EasiTable(Base):
    __tablename__ = "easi_tables"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    experiment_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    column_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Audit Log
# ---------------------------------------------------------------------------
class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    experiment_id: Mapped[int | None] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), nullable=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    changes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    experiment: Mapped[Experiment | None] = relationship(back_populates="audit_logs")


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
class SessionRecord(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions")
