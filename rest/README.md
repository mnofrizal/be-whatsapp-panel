# REST API Testing Files

This directory contains REST client files for testing the WhatsApp API Backend endpoints using VS Code REST Client extension or similar tools.

## Prerequisites

1. **Install REST Client Extension** (VS Code):

   - Open VS Code
   - Go to Extensions (Ctrl+Shift+X)
   - Search for "REST Client" by Huachao Mao
   - Install the extension

2. **Start the Server**:
   ```bash
   npm run dev
   ```
   Server should be running on `http://localhost:3000`

## Available Test Files

### `auth.rest`

Tests all authentication endpoints including:

- User registration
- User login
- Get current user info
- Change password
- Token refresh
- Logout
- Error scenarios and validation testing
- Rate limiting tests

## How to Use

1. **Open a `.rest` file** in VS Code
2. **Click "Send Request"** above any HTTP request
3. **View the response** in the right panel
4. **Copy JWT tokens** from login responses to use in authenticated requests

## Testing Flow

### 1. Basic Flow

```
1. Health Check → GET /health
2. Register User → POST /api/auth/register
3. Login → POST /api/auth/login (copy the JWT token)
4. Get User Info → GET /api/auth/me (paste JWT token)
5. Change Password → POST /api/auth/change-password
6. Logout → POST /api/auth/logout
```

### 2. Error Testing

```
1. Invalid email format
2. Short password
3. Missing required fields
4. Wrong credentials
5. Unauthorized access
6. Invalid tokens
7. Rate limiting
8. Duplicate registration
```

## Expected Responses

### Successful Registration

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_abc123",
      "email": "admin@example.com",
      "name": "Admin User",
      "role": "ADMINISTRATOR"
    },
    "subscription": {
      "id": "sub_xyz789",
      "name": "Admin User's Subscription",
      "tier": "BASIC",
      "maxInstances": 5
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### Successful Login

```json
{
  "success": true,
  "data": {
    "user": { ... },
    "subscription": { ... },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "errors": [
        {
          "field": "email",
          "message": "Please provide a valid email address"
        }
      ]
    }
  }
}
```

## Tips

1. **Copy JWT Tokens**: After login, copy the JWT token and replace `YOUR_JWT_TOKEN_HERE` in other requests
2. **Test Rate Limiting**: Run the same request multiple times quickly to test rate limiting
3. **Check Logs**: Monitor the server console for detailed logs
4. **Database**: Use `npx prisma studio` to view database changes
5. **Health Check**: Always start with health check to ensure server is running

## Troubleshooting

### Server Not Responding

- Check if server is running: `npm run dev`
- Verify port 3000 is not in use
- Check server logs for errors

### Authentication Errors

- Ensure JWT token is valid and not expired
- Check token format: `Bearer <token>`
- Verify user exists and is active

### Database Errors

- Run `npx prisma db push` to sync database
- Check if database file exists
- Verify Prisma client is generated

### Validation Errors

- Check request body format
- Ensure all required fields are provided
- Verify data types match schema

## Next Steps

As we implement more features in future phases, additional REST files will be added:

- `instances.rest` - Instance management
- `messages.rest` - Message sending
- `webhooks.rest` - Webhook configuration
- `admin.rest` - Admin operations
