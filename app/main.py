from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import pandas as pd
import logging
import requests
import tempfile
from io import BytesIO
from datetime import datetime, timedelta
import numpy as np
from typing import List, Dict, Optional
import rasterio
from rasterio import features
from rasterio.errors import RasterioIOError
import os
from typing import List
import requests
from pydantic import BaseModel
import urllib.request


from app.utils.raster_utils import get_pixel_value, get_transect_values
from app.utils.url_utils import format_url
from app.utils.time_utils import generate_dates_in_range

# Add this near your other Pydantic models (if any)
class PolygonRequest(BaseModel):
    url: str
    polygon: dict  # GeoJSON polygon geometry

def is_valid(x):
    if isinstance(x, (list, np.ndarray)):
        return len(x) > 0 and x[0] is not None
    return pd.notnull(x)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variable for in situ data
INSITU_DF = None
INSITU_DATES_CACHE = None

@app.on_event("startup")
async def load_insitu_data():
    """Load in situ data at application startup"""
    global INSITU_DF, INSITU_DATES_CACHE
    try:
        pickle_url = "https://storage.googleapis.com/insitu_data/LIS_insitu_data.pkl"
        logger.info(f"Loading in situ data from: {pickle_url}")
        
        # Download the pickle file
        response = requests.get(pickle_url)
        response.raise_for_status()
        
        # Load from bytes
        INSITU_DF = pd.read_pickle(BytesIO(response.content))
        
        # Debug: Check initial date format
        logger.info(f"Initial date column type: {INSITU_DF['date'].dtype}")
        logger.info(f"Sample dates: {INSITU_DF['date'].head()}")
        
        # Convert 'date' column from string to datetime
        if 'date' in INSITU_DF.columns:
            # First convert to datetime
            INSITU_DF['date'] = pd.to_datetime(INSITU_DF['date'])
            
            # Then clean the data columns
            for var in ['chl', 'spm', 'cdom']:
                if var in INSITU_DF.columns:
                    # Convert any list/array values to single float
                    INSITU_DF[var] = INSITU_DF[var].apply(
                        lambda x: float(x[0]) if isinstance(x, (list, np.ndarray)) and len(x) > 0 else x
                    )
                    # Replace any non-finite values with NaN
                    INSITU_DF[var] = pd.to_numeric(INSITU_DF[var], errors='coerce')
        
        # Debug: Verify cleaned data
        logger.info(f"Cleaned data sample:\n{INSITU_DF.head()}")
        logger.info(f"Data types:\n{INSITU_DF.dtypes}")
        
    except Exception as e:
        logger.error(f"Failed to load in situ data: {str(e)}", exc_info=True)
        INSITU_DF = None
        INSITU_DATES_CACHE = None

@app.get("/get_available_dates")
async def get_available_dates(
    
    variable: str = Query(..., description="Variable name (chl, spm, or cdom)")
):
    """
    Retrieve all unique dates that have in situ data for the specified variable
    Returns: { "dates": ["YYYY-MM-DD", ...] } or detailed error info
    """
    if INSITU_DF is None:
        logger.error("In situ data not loaded - INSITU_DF is None")
        raise HTTPException(
            status_code=503,
            detail="In situ data not loaded. Please try again later."
        )

    try:
        # Validate variable
        valid_variables = ['chl', 'spm', 'cdom']
        if variable not in valid_variables:
            logger.error(f"Invalid variable requested: {variable}")
            raise HTTPException(
                status_code=400,
                detail=f"Invalid variable. Must be one of: {', '.join(valid_variables)}"
            )

        # Check if variable exists in dataframe
        if variable not in INSITU_DF.columns:
            logger.error(f"Variable {variable} not found in dataframe. Available columns: {INSITU_DF.columns.tolist()}")
            return JSONResponse(
                status_code=404,
                content={"error": f"Variable {variable} not found in dataset"}
            )

        # Verify date column exists and is datetime
        if 'date' not in INSITU_DF.columns:
            logger.error("'date' column not found in dataframe")
            return JSONResponse(
                status_code=500,
                content={"error": "Date column missing in dataset"}
            )
            
        if not pd.api.types.is_datetime64_any_dtype(INSITU_DF['date']):
            logger.error(f"Date column is not datetime type. Current type: {INSITU_DF['date'].dtype}")
            return JSONResponse(
                status_code=500,
                content={"error": "Date column is not in datetime format"}
            )

        # Filter for dates with valid data
        mask = (
            INSITU_DF[variable].notna() & 
            (INSITU_DF[variable] != -9999) &
            INSITU_DF['date'].notna()
        )
        
        if not mask.any():
            logger.warning(f"No valid data found for variable {variable}")
            return {"dates": []}

        valid_dates = INSITU_DF.loc[mask, 'date'].dt.date.unique()

        # Convert to ISO format strings and sort
        sorted_dates = sorted([date.isoformat() for date in valid_dates if date is not None])

        logger.info(f"Returning {len(sorted_dates)} dates for {variable}")
        return {"dates": sorted_dates}

    except Exception as e:
        logger.error(f"Critical error in get_available_dates: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )

@app.get("/get_insitu_data")
async def get_insitu_data(
    variable: str = Query(..., description="Variable name (chl, spm, or cdom)"),
    date: str = Query(..., description="Date in YYYY-MM-DD format")
) -> Dict[str, List[Dict]]:
    """
    Retrieve in situ data for a specific variable and date
    Returns: { "data": [ { "lat": float, "lon": float, "value": float, "date": str }, ... ] }
    """
    if INSITU_DF is None:
        raise HTTPException(
            status_code=503,
            detail="In situ data not loaded. Please try again later."
        )

    try:
        # Validate variable
        valid_variables = ['chl', 'spm', 'cdom']
        if variable not in valid_variables:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid variable. Must be one of: {', '.join(valid_variables)}"
            )

        # Parse and validate date
        try:
            target_date = pd.to_datetime(date).date()
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Invalid date format. Use YYYY-MM-DD"
            )

        # Filter data
        filtered = INSITU_DF[
            (INSITU_DF['date'].dt.date == target_date) &
            INSITU_DF[variable].apply(is_valid)
        ]

        if filtered.empty:
            raise HTTPException(
                status_code=404,
                detail=f"No {variable} data available for {date}"
            )

        # Prepare response
        result = []
        for _, row in filtered.iterrows():
            try:
                val = row[variable]
                if isinstance(val, (list, np.ndarray)):
                    val = val[0]
                result.append({
                    "lat": float(row['lat']),
                    "lon": float(row['lon']),
                    "value": float(val),
                    "date": row['date'].isoformat(),
                    "variable": variable
                })
            except (IndexError, ValueError, TypeError) as e:
                logger.warning(f"Skipping invalid data point: {str(e)}")
                continue

        return {"data": result}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Server error: {str(e)}"
        )

@app.get("/get_value")
def get_value(
    url: str = Query(...),
    lat: float = Query(...),
    lon: float = Query(...)
) -> Dict[str, float]:
    """
    Get pixel value at specified coordinates
    Returns: { "value": float, "lat": float, "lon": float }
    """
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
) -> Dict[str, List]:
    """
    Get timeseries data for a location and date range
    Returns: { "values": [float], "dates": [str], "location": dict, "variable": str }
    """
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
    
@app.get("/debug_dates_processing")
async def debug_dates_processing(variable: str = "chl"):
    """Debug endpoint for date processing"""
    if INSITU_DF is None:
        return {"error": "Data not loaded"}
    
    try:
        # Show raw date column info
        date_info = {
            "dtype": str(INSITU_DF['date'].dtype),
            "sample_values": INSITU_DF['date'].head().tolist(),
            "null_count": INSITU_DF['date'].isnull().sum()
        }
        
        # Show variable column info
        var_info = {
            "exists": variable in INSITU_DF.columns,
            "dtype": str(INSITU_DF[variable].dtype) if variable in INSITU_DF.columns else None,
            "sample_values": INSITU_DF[variable].head().tolist() if variable in INSITU_DF.columns else None,
            "null_count": INSITU_DF[variable].isnull().sum() if variable in INSITU_DF.columns else None
        }
        
        return {
            "date_info": date_info,
            "variable_info": var_info
        }
    except Exception as e:
        return {"error": str(e)}
    
# Add this with your other API endpoints
@app.post("/get_polygon_stats")
async def get_polygon_stats(request: PolygonRequest):
    logger.info(f"Processing request for URL: {request.url}")
    try:
        # Validate polygon
        if not isinstance(request.polygon.get('coordinates'), list):
            raise HTTPException(status_code=400, detail="Invalid coordinates")

        tmp_path = None
        try:
            # Download file
            with tempfile.NamedTemporaryFile(suffix='.tif', delete=False) as tmp_file:
                tmp_path = tmp_file.name
            urllib.request.urlretrieve(request.url, tmp_path)

            with rasterio.open(tmp_path) as src:
                # 1. Verify raster has data
                sample = src.read(1, window=((0, 10000), (0, 1000)))
                if np.all(sample == src.nodata):
                    raise HTTPException(status_code=400, detail="Raster has no valid data")

                # height, width = src.shape
                # sample_size = int(min(height, width) * 0.1)  # 10% of smaller dimension

                # windows = [
                #     ((0, sample_size), (0, sample_size)),  # Top-left
                #     ((0, sample_size), (width-sample_size, width)),  # Top-right
                #     ((height-sample_size, height), (0, sample_size)),  # Bottom-left
                #     ((height-sample_size, height), (width-sample_size, width)),  # Bottom-right
                #     ((height//2-sample_size//2, height//2+sample_size//2), 
                #     (width//2-sample_size//2, width//2+sample_size//2))  # Center
                # ]

                # has_data = False
                # for window in windows:
                #     sample = src.read(1, window=window)
                #     if not np.all(sample == src.nodata):
                #         has_data = True
                #         break

                # if not has_data:
                #     raise HTTPException(status_code=400, detail="No valid data found in sampled regions")

                # 2. Check polygon intersects raster
                from shapely.geometry import shape, box
                raster_bbox = box(*src.bounds)
                polygon_shape = shape(request.polygon)
                if not raster_bbox.intersects(polygon_shape):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Polygon outside raster bounds: {src.bounds}"
                    )

                # 3. Transform coordinates if needed
                if src.crs and src.crs != "EPSG:4326":
                    from rasterio.warp import transform_geom
                    request.polygon = transform_geom("EPSG:4326", src.crs, request.polygon)

                # 4. Create mask and validate
                mask = features.geometry_mask(
                    [request.polygon],
                    out_shape=src.shape,
                    transform=src.transform,
                    invert=True
                )
                if mask.sum() == 0:
                    raise HTTPException(
                        status_code=400,
                        detail="Polygon covers no raster pixels (check CRS and coordinates)"
                    )

                # 5. Process data
                data = src.read(1, masked=True)
                valid_data = data[mask].compressed()
                if src.nodata is not None:
                    valid_data = valid_data[valid_data != src.nodata]

                if len(valid_data) == 0:
                    raise HTTPException(
                        status_code=404,
                        detail="No valid data (all values were no-data)"
                    )

                return {
                    "mean": float(np.mean(valid_data)),
                    "min": float(np.min(valid_data)),
                    "max": float(np.max(valid_data)),
                    "std": float(np.std(valid_data)),
                    "count": len(valid_data),
                    "raster_bounds": src.bounds,
                    "raster_crs": str(src.crs)
                }

        except Exception as e:
            logger.error(f"Processing failed: {str(e)}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    
