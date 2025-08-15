from rasterio.errors import RasterioError, RasterioIOError
import rasterio
from rasterio.warp import transform
import numpy as np
import math
from app.utils.url_utils import format_google_url

def get_pixel_value(url: str, lat: float, lon: float) -> float:
    try:
        url = format_google_url(url)
        with rasterio.Env():
            with rasterio.open(url) as src:
                lon_proj, lat_proj = transform("EPSG:4326", src.crs, [lon], [lat])
                row, col = src.index(lon_proj[0], lat_proj[0])
                value = src.read(1, window=((row, row+1), (col, col+1)))
                val = float(value[0, 0])
                return val if val != -9999 else None
    except (RasterioError, RasterioIOError) as e:
        print(f"Rasterio error in get_pixel_value: {str(e)}")
        return None
    except Exception as e:
        print(f"Unexpected error in get_pixel_value: {str(e)}")
        return None

def get_transect_values(url, start_lat, start_lon, end_lat, end_lon):
    try:
        url = format_google_url(url)
        with rasterio.Env():
            with rasterio.open(url) as src:
                start_lon_proj, start_lat_proj = transform("EPSG:4326", src.crs, [start_lon], [start_lat])
                end_lon_proj, end_lat_proj = transform("EPSG:4326", src.crs, [end_lon], [end_lat])
                start_row, start_col = src.index(start_lon_proj[0], start_lat_proj[0])
                end_row, end_col = src.index(end_lon_proj[0], end_lat_proj[0])
                num_points = int(math.hypot(end_row - start_row, end_col - start_col)) + 1
                rows = np.linspace(start_row, end_row, num_points)
                cols = np.linspace(start_col, end_col, num_points)
                distances = np.linspace(0, num_points * 0.3, num_points)
                values, valid_distances = [], []
                
                for i, (row, col) in enumerate(zip(rows, cols)):
                    value = src.read(1, window=((int(row), int(row)+1), (int(col), int(col)+1)))
                    val = float(value[0, 0])
                    if val != -9999:
                        values.append(val)
                        valid_distances.append(distances[i])
                return values, valid_distances
    except (RasterioError, RasterioIOError) as e:
        print(f"Rasterio error in get_transect_values: {str(e)}")
        return [], []
    except Exception as e:
        print(f"Unexpected error in get_transect_values: {str(e)}")
        return [], []