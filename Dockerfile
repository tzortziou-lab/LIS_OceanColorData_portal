# Use an official Python base image
FROM python:3.12-slim

# Set working directory inside the container
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy your app source code
COPY ./app /app/app

# Run FastAPI with uvicorn on the required port
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
