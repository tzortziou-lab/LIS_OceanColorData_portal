from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.utils.raster_utils import get_pixel_value, get_transect_values
from app.utils.url_utils import format_url
from app.utils.time_utils import generate_dates_in_range

app = FastAPI()

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/get_value")
def get_value(
    url: str = Query(...),
    lat: float = Query(...),
    lon: float = Query(...)
):
    try:
        value = get_pixel_value(url, lat, lon)
        if value is None:
            return JSONResponse(status_code=404, content={"error": "No data at this location"})
        return {
            "value": value,
            "lat": lat,
            "lon": lon
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/get_transect")
def get_transect(
    url: str = Query(...),
    start_lat: float = Query(...),
    start_lon: float = Query(...),
    end_lat: float = Query(...),
    end_lon: float = Query(...)
):
    try:
        values, distances = get_transect_values(url, start_lat, start_lon, end_lat, end_lon)
        
        if not values:
            return JSONResponse(status_code=404, content={"error": "No valid data along transect"})
        
        return {
            "values": values,
            "distances": distances,
            "start_point": {"lat": start_lat, "lon": start_lon},
            "end_point": {"lat": end_lat, "lon": end_lon}
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/get_timeseries")
def get_timeseries(
    lat: float = Query(...),
    lon: float = Query(...),
    variable: str = Query(...),
    start_date: str = Query(...),
    end_date: str = Query(...)
):
    try:
        dates = generate_dates_in_range(start_date, end_date)
        values = []
        valid_dates = []
        
        for date in dates:
            url = format_url(date, variable)
            value = get_pixel_value(url, lat, lon)
            
            if value is not None:
                values.append(value)
                valid_dates.append(date)
        
        if not values:
            return JSONResponse(status_code=404, content={"error": "No data available for the selected date range"})
        
        return {
            "values": values,
            "dates": valid_dates,
            "location": {"lat": lat, "lon": lon},
            "variable": variable
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
