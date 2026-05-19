import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from pydantic import BaseModel, Field
from pprint import pprint
from typing import List, Optional, Any
from database import (
    init_db,
    Profile,
    Analysis,
    QualitativeModel,
    DataSourceModel,
    DataSource,
    DataSourceFilter,
)
from beanie import PydanticObjectId
from beanie import Document
from pymongo import MongoClient
import pandas as pd
from datetime import datetime
from loguru import logger
import httpx

##############################################
HOST = "0.0.0.0"
PORT = 8080
RELOAD = True
##############################################


class ProfileModel(BaseModel):
    id: PydanticObjectId
    name: Optional[str] = None
    qualitative: Optional[List[QualitativeModel]] = None
    data_sources: Optional[List[DataSourceModel]] = None


class ProfileInfo(BaseModel):
    id: PydanticObjectId = Field(..., alias="_id")
    name: str
    created_at: datetime


class Metric(BaseModel):
    filters: Any


class AnalysisConfig(BaseModel):
    id: str
    share: str
    exchange: str
    profile: str
    name: str


class AnalysisInfo(BaseModel):
    id: PydanticObjectId = Field(..., alias="_id")
    share: str
    exchange: str
    profile: str
    name: str
    created_at: datetime
    score: Optional[float] = None


##############################################

app = FastAPI(title="Relativity AI Portfolio API", version="1.0.0")
origins = [
    "http://localhost",
    "http://localhost:5173",
]


app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    logger.info("Initializing database...")
    await init_db()
    logger.info("Database initialized successfully")

##############################################
equities_path = "./assets/nse-equities.csv"
exchanges_path = "./assets/exchanges.csv"

equities = pd.read_csv(equities_path)[["SYMBOL", "NAME"]]
eq_symbols = equities["SYMBOL"].str.lower()
eq_names = equities["NAME"].str.lower()

exchanges = pd.read_csv(exchanges_path)
ex_symbols = exchanges["SYMBOL"].str.lower()
ex_countries = exchanges["COUNTRY"].str.lower()
ex_names = exchanges["NAME"].str.lower()


##############################################
import re

##############################################
# Dynamic Service Discovery
def get_service_config():
    config = {
        "api": {"external": 8080, "internal": 8080},
        "voyager": {"external": 8001, "internal": 8001},
        "nebula": {"external": 8002, "internal": 8002}
    }
    try:
        path = "../docker-compose.yml"
        if not os.path.exists(path):
            path = "docker-compose.yml"
            
        if os.path.exists(path):
            with open(path, "r") as f:
                content = f.read()
                parts = re.split(r'^\s\s\w+:', content, flags=re.MULTILINE)
                services = re.findall(r'^\s\s(\w+):', content, flags=re.MULTILINE)
                service_map = dict(zip(services, parts[1:]))
                
                for s_name in config.keys():
                    if s_name in service_map:
                        port_match = re.search(r'ports:.*-\s*"(\d+):(\d+)"', service_map[s_name], re.DOTALL)
                        if port_match:
                            config[s_name]["external"] = int(port_match.group(1))
                            config[s_name]["internal"] = int(port_match.group(2))
    except Exception as e:
        logger.error(f"Error parsing docker-compose.yml: {e}")
    return config

SERVICE_CONFIG = get_service_config()
VOYAGER_URL = f"http://voyager:{SERVICE_CONFIG['voyager']['internal']}"
NEBULA_URL = f"http://nebula:{SERVICE_CONFIG['nebula']['internal']}"
##############################################

@app.get("/services")
def list_services():
    return get_service_config()

##############################################


@app.get("/")
def ping():
    return {"ok": 1}

from database import MONGO_URL
from pymongo import AsyncMongoClient

# Shared client for health checks
db_client = AsyncMongoClient(MONGO_URL)

@app.get("/db")
async def db_ping():
    try:
        # Ping the server directly using the client
        await db_client.admin.command('ping')
        return {"ok": 1}
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        return {"ok": 0, "error": str(e)}


async def check_service_health(url: str):
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, timeout=2.0)
            if resp.status_code == 200:
                return resp.json()
            return {"ok": 0}
    except Exception as e:
        logger.error(f"Error checking health at {url}: {e}")
        return {"ok": 0}


@app.get("/voyager")
async def voyager_ping():
    return await check_service_health(f"{VOYAGER_URL}/")


@app.get("/nebula")
async def nebula_ping():
    return await check_service_health(f"{NEBULA_URL}/")


@app.get("/search-shares")
async def search_shares(query: str):
    if not query:
        return equities.head(5).to_dict(orient="records")
    q = query.lower()
    exact_symbol = eq_symbols.eq(q).astype(int)
    exact_name = eq_names.eq(q).astype(int)
    symbol_match = eq_symbols.str.contains(q, na=False, case=False).astype(int)
    names_match = eq_names.str.contains(q, na=False, case=False).astype(int)

    equities["score"] = (
        exact_symbol * 4 + exact_name * 3 + symbol_match * 2 + names_match * 1
    )

    return (
        equities.sort_values("score", ascending=False).head(5).to_dict(orient="records")
    )


@app.get("/search-exchanges")
async def search_shares(query: str):
    if not query:
        return exchanges.head(5).to_dict(orient="records")
    q = query.lower()

    exact_symbol = ex_symbols.eq(q).astype(int)
    exact_name = ex_names.eq(q).astype(int)
    exact_countries = ex_countries.eq(q).astype(int)

    names_match = ex_names.str.contains(q, na=False, case=False).astype(int)
    symbols_match = ex_symbols.str.contains(q, na=False, case=False).astype(int)
    countries_match = ex_countries.str.contains(q, na=False, case=False).astype(int)

    exchanges["score"] = (
        exact_symbol * 4
        + exact_name * 3
        + exact_countries * 3
        + symbols_match * 2
        + names_match * 2
        + countries_match * 2
    )

    return (
        exchanges.sort_values("score", ascending=False)
        .head(5)
        .to_dict(orient="records")
    )


@app.get("/search-profiles")
async def search_shares(query: str):
    if not query:
        return []

    matches = (
        await Profile.find(Profile.name == {"$regex": query, "$options": "i"})
        .project(ProfileInfo)
        .sort(-Profile.name)
        .to_list()
    )
    return matches


@app.get("/list-data-sources")
async def list_data_source():
    sources = await DataSource.find_all().to_list()
    return sources


@app.get("/list-metrics")
async def list_metrics(source: str):
    metrics = (
        await DataSource.find(DataSource.source == source).project(Metric).to_list()
    )
    if metrics:
        return [m["metric"] for m in metrics[0].filters]
    return []


@app.get("/list-tools")
async def list_tools():
    pass


@app.get("/dummy-profile")
def dummy_profile():
    return {
        "qualitative": [
            {
                "param": "Management",
                "content": "Management should be dedicated.",
            },
            {"param": "Growth", "content": "Revenue, EPS, Volume."},
            {"param": "Valuations", "content": "Cheap valuations."},
        ],
        "data_sources": {
            "screener": {
                "pe": "25",
            },
            "trendlyne": {"opp_score": 5},
        },
    }


@app.get("/list-profiles")
async def list_profiles():
    profiles = await Profile.find_all().project(ProfileInfo).to_list()
    return profiles


@app.get("/read-profile")
async def read_profile(id: str):
    profile = await Profile.get(id)
    return profile


@app.get("/create-profile")
async def create_profile(
    name: str = datetime.now().strftime("%Y-%m-%d-%H-%M-%S"),
    qualitative=[],
    data_sources=[],
):
    data = {"name": name, "id": "", "ok": 0, "created_at": ""}
    try:
        profile = Profile(name=name, qualitative=qualitative, data_sources=data_sources)
        await profile.insert()

        print(profile.created_at)

        data["id"] = str(profile.id)
        data["ok"] = 1
        data["created_at"] = profile.created_at
    except Exception as e:
        print(e)
    return data


@app.post("/update-profile")
async def update_profile(profile: ProfileModel):
    p = await Profile.find_one(Profile.id == profile.id)
    if profile.name:
        p.name = profile.name
    if profile.qualitative:
        p.qualitative = profile.qualitative
    if profile.data_sources:
        p.data_sources = profile.data_sources
    await p.save()


@app.post("/delete-profile")
async def delete_profile(profile: ProfileModel):
    try:
        profile = await Profile.get(profile.id)
        await profile.delete()
        return {"ok": 1}
    except Exception as e:
        print(e)
        return {"ok": 0}


@app.post("/create-data-source")
async def create_data_source(source: DataSourceModel):
    ds = DataSource(
        source=source.source,
        image=source.source,
        filters=[
            DataSourceFilter(
                metric=f.metric,
                direction=f.direction,
                threshold=f.threshold,
                upper=f.upper,
                lower=f.lower,
            )
            for f in source.filters
        ],
    )
    await DataSource.insert_many([ds])


@app.post("/delete-data-source")
async def delete_data_source(source: DataSourceModel):
    bar = await DataSource.find_one(DataSource.source == source.source)
    await bar.delete()


@app.post("/update-data-sources")
async def update_data_source(sources: List[DataSourceModel]):

    for source in sources:
        # s = await DataSource.find_one(DataSource._id == source.id)
        s = await DataSource.get(source.id)

        if s:
            if (
                s.source == source.source
                and s.filters == source.filters
                and s.image == source.image
            ):
                continue

            s.source = source.source
            s.filters = source.filters
            s.image = source.image
            await s.save()

        else:
            print(f"No existing datasource called : {source.source}")


@app.get("/create-analysis")
async def create_analysis(
    name: str = "analysis-" + datetime.now().strftime("%Y-%m-%d-%H-%M-%S"),
):
    data = {"name": name, "id": "", "ok": 0, "created_at": ""}
    analysis = Analysis(
        name=name,
        share="",
        exchange="",
        profile="",
        qualitative_scores=[],
        data_sources_scores=[],
    )
    await analysis.insert()

    data["id"] = str(analysis.id)
    data["ok"] = 1
    data["created_at"] = analysis.created_at

    pprint(data)

    return data


@app.get("/list-analysis")
async def list_analysis():
    analysis = await Analysis.find_all().project(AnalysisInfo).to_list()
    return analysis


@app.get("/delete-analysis")
async def delete_analysis(id: str):
    try:
        analysis = await Analysis.get(id)
        await analysis.delete()
        return {"ok": 1}
    except Exception as e:
        print(e)
        return {"ok": 0}


@app.post("/run-analysis")
async def run_analysis(config: AnalysisConfig):

    pprint(config)

    # check if name exists
    analysis = Analysis.get(config.id)
    share = config.share
    exchange = config.exchange
    profile = config.profile
    name = config.name

    # run background analysis task - when completes, update status

    return {"ok": 1}


@app.get("/analysis-status")
async def analysis_status(id: str):
    pass


@app.get("/read-analysis")
async def read_analysis(id: str):
    pass


if __name__ == "__main__":
    uvicorn.run("api:app", host=HOST, port=PORT, reload=RELOAD)
