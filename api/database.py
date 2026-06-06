from motor.motor_asyncio import AsyncIOMotorClient as AsyncMongoClient
from beanie import init_beanie, Document, Indexed
from pydantic import BaseModel, Field
from typing import List, Optional, Any
from datetime import datetime
import os
from litellm.utils import ModelResponse

MONGO_URL = os.getenv(
    "MONGO_URI",
    "mongodb://root:example@relativity-mongo:27017"
)

MONGO_DB_NAME = "relativity"

##############################################

# Beanie document helpers


class Tool(BaseModel):
    name: str


class QualitativeModel(BaseModel):
    parameter: str
    content: str
    # tools: Optional[List[Tool]] = []
    # weight: Optional[float] = 0.0

class DataSourceFilter(BaseModel):
    metric: str
    direction: Optional[Any] = "higher"
    threshold: Optional[Any] = None
    upper: Optional[Any] = None
    lower: Optional[Any] = None
    title: Optional[str] = None
    type: Optional[str] = None

class DataSourceModel(BaseModel):
    source: str
    image: Optional[str] = ""
    filters: List[DataSourceFilter] = []


# Beanie documents/ mongo schemes


class DataSource(Document):
    source: str
    image: Optional[str] = None
    filters: List[DataSourceFilter]

    class Settings:
        name = "data_sources"


class Profile(Document):
    name: Indexed(str, unique=True)
    qualitative: List[QualitativeModel]
    data_sources: List[DataSourceModel]
    created_at: datetime = Field(default_factory=datetime.now)

    class Settings:
        name = "profiles"


class QualitativeScore(BaseModel):
    parameter: str
    score: float
    response: ModelResponse


class DataSourceScore(BaseModel):
    parameter: str
    value: Any
    score: float


class Analysis(Document):
    share: str
    exchange: str
    profile: str
    name: str
    status: Optional[str] = "EMPTY"

    created_at: datetime = Field(default_factory=datetime.now)
    end: Optional[datetime] = None
    duration: Optional[float] = None

    model: Optional[str] = None
    iterations: Optional[int] = None
    rpm: Optional[int] = None

    qualitative_scores: List[QualitativeScore]
    qualitative_weighted: Optional[float] = None
    data_sources_scores: List[DataSourceScore]
    data_sources_weighted: Optional[float] = None
    score: Optional[float] = None

    class Settings:
        name = "analysis"


##############################################


async def init_db():
    client = AsyncMongoClient(MONGO_URL)
    await init_beanie(
        database=client[MONGO_DB_NAME],
        document_models=[
            Profile,
            DataSource,
            Analysis,
        ],
    )


async def test_database():

    await init_db()

    # qp1 = QualitativeModel(
    #     parameter="Management",
    #     content="Management should be good and dedicated. Long history of experience in the market.",
    # )
    # qp2 = QualitativeModel(parameter="Growth", content="Revenue EPS Volume.")
    # qp3 = QualitativeModel(parameter="Valuations", content="Cheap valuations")

    # ds1f1 = DataSourceFilter(metric="pe", direction="lower", threshold=100, upper=150)
    # ds2f1 = DataSourceFilter(metric="opp_score", direction="higher", threshold=5, lower=2)

    # ds1 = DataSourceModel(source="screener", filters=[ds1f1])
    # ds2 = DataSourceModel(source="trendlyne", filters=[ds2f1])

    # profile1 = Profile(name="test-profile", qualitative=[qp1, qp2, qp3], data_sources=[ds1, ds2])
    # await Profile.insert_many([profile1])

    ds1 = DataSource(
        source="screener",
        image="https://play-lh.googleusercontent.com/9E_9erPqls3yWgVokNevGGahIxzecFSYvnUAMtVMpES1sieGjZXW4s9ybpJPNP42CZ6h=w240-h480-rw",
        filters=[
            DataSourceFilter(metric="pe"),
            DataSourceFilter(metric="ps"),
            DataSourceFilter(metric="cagr_1y"),
            DataSourceFilter(metric="cagr_3y"),
        ],
    )
    await DataSource.insert_many([ds1])


import asyncio

if __name__ == "__main__":
    asyncio.run(test_database())
