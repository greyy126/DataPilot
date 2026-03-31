from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# backend/ directory (parent of app/)
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
DATABASE_URL = f"sqlite:///{BACKEND_DIR / 'data_collector.db'}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
