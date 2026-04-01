from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db.base import Base
from app.db.session import engine
from app.api.routes import clean as clean_routes
from app.api.routes import profile as profile_routes
from app.api.routes import suggestions as suggestions_routes
from app.api.routes import upload as upload_routes
from app.models.schemas import HealthResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Data Collector API",
    lifespan=lifespan,
)

# ✅ ADD THIS BLOCK HERE
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# existing routes
app.include_router(upload_routes.router, tags=["upload"])
app.include_router(profile_routes.router, tags=["profile"])
app.include_router(suggestions_routes.router, tags=["suggestions"])
app.include_router(clean_routes.router, tags=["clean"])


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="ok")
