#!/bin/bash

# Create PocketBase admin account
echo "Creating PocketBase admin account..."

curl -X POST http://localhost:8090/api/collections/_superusers/records \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@camp.local",
    "password": "campbunking123",
    "passwordConfirm": "campbunking123"
  }'

echo -e "\n\nAdmin account created!"
echo "Login at: http://localhost:8090/_/"
echo "Email: admin@camp.local"
echo "Password: campbunking123"