from urllib.parse import quote
import datetime

def format_url(date: str, variable: str) -> str:
    dt = datetime.datetime.strptime(date, "%Y-%m-%d")
    path = dt.strftime("%Y/%m/%d")
    compact = dt.strftime("%Y%m%d")
    return f"https://storage.googleapis.com/lis-olci-netcdfs/{path}/LIS_{compact}_{variable}.tif"

def format_google_url(url: str) -> str:
    if "storage.googleapis.com" in url and "/o/" not in url:
        bucket_object = url.split("https://storage.googleapis.com/")[1]
        bucket, *object_parts = bucket_object.split("/")
        object_path = quote("/".join(object_parts), safe='')
        return f"https://storage.googleapis.com/download/storage/v1/b/{bucket}/o/{object_path}?alt=media"
    return url
