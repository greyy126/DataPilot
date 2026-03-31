from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db.base import Base
from app.db.session import engine
from app.api.routes import upload as upload_routes
from app.models.schemas import HealthResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Import ORM models here when added so metadata registers tables.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Data Collector API",
    lifespan=lifespan,
)

app.include_router(upload_routes.router, tags=["upload"])


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="ok")
