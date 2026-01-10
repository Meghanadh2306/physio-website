# Netlify Deployment Guide

## Files Created/Modified

### 1. **frontend/.env**
Environment variables for the frontend:
```
VITE_API_URL=https://physio-website-nih7.onrender.com
```

### 2. **netlify.toml**
Netlify configuration file with:
- Build command configuration
- Client-side routing redirects
- Cache headers for assets
- Dev server settings

### 3. **backend/.env**
Environment variables for the backend:
```
MONGO_URL=mongodb+srv://bulasarameghanadh_db_user:TReIYTxSqxCqrRWt@cluster0.zicicla.mongodb.net/?appName=Cluster0
JWT_SECRET=physio_super_secret_key
PORT=5500
CORS_ORIGIN=*
NODE_ENV=production
```

### 4. **frontend/config.js**
Centralized API configuration that auto-detects environment:
- Local development: `http://localhost:5500`
- Production: `https://physio-website-nih7.onrender.com`

## All Fixed Issues

### ✅ Fixed in Frontend Files:
1. **Removed hardcoded `/frontend/` paths** from all HTML files
   - Changed: `location.href = "/frontend/dashboard.html"` → `location.href = "dashboard.html"`
   - Changed: `location.href = "/frontend/index.html"` → `location.href = "index.html"`

2. **Centralized API URL** - All files now use `config.js`
   - Removed: `const API = "https://physio-website-nih7.onrender.com"`
   - Added: `<script src="config.js"></script>` to all HTML files

3. **Fixed token redirect paths** - All authentication checks use relative paths
   - Changed: `location.href = "/"` → `location.href = "index.html"`

### Files Modified:
- index.html
- dashboard.html
- patient.html
- doctor.html
- appointment.html
- change-password.html
- doctor-report.html
- recommended-doctor.html
- reports-dashboard.html
- treatment-master.html

## Deployment to Netlify

### Step 1: Connect to Netlify
1. Push your code to GitHub
2. Connect your GitHub repository to Netlify
3. Build settings:
   - **Build command**: `npm install` (for static site)
   - **Publish directory**: `frontend`
   - **Functions directory**: Leave blank

### Step 2: Add Environment Variables
In Netlify Dashboard → Site Settings → Build & Deploy → Environment:
```
VITE_API_URL=https://physio-website-nih7.onrender.com
```

### Step 3: Deploy
- Netlify will automatically build and deploy on every push to main branch
- The `netlify.toml` file handles routing and caching automatically

## Testing Locally

### Frontend:
```bash
cd frontend
# Open index.html in browser or use a local server:
python -m http.server 8000
# Visit: http://localhost:8000
```

### Backend:
```bash
cd backend
npm install
npm start
# Backend runs on http://localhost:5500
```

## API Endpoints (from Render)
Base URL: `https://physio-website-nih7.onrender.com`

### Authentication:
- POST `/login` - Admin login
- POST `/admin/change-password` - Change password

### Patient Management:
- GET `/patients` - List all patients
- GET `/patient/:id` - Get patient details
- POST `/patient/:id` - Update patient
- POST `/patient/:id/treatments/add` - Add treatment

### Doctors:
- GET `/doctors` - List all doctors
- POST `/doctors` - Add doctor
- PUT `/doctors/:id` - Update doctor

### Treatments:
- GET `/treatments` - List treatments
- POST `/treatments` - Create treatment
- PUT `/treatments/:id` - Update treatment
- DELETE `/treatments/:id` - Delete treatment

## Backend Deployment (if needed)

The backend is already deployed on Render at:
`https://physio-website-nih7.onrender.com`

If you need to redeploy:
1. Push code to GitHub (backend folder)
2. Connect to Render
3. Set environment variables in Render dashboard
4. Deploy

## Troubleshooting

### Issue: "API not reachable" error
- Ensure backend is running on `https://physio-website-nih7.onrender.com`
- Check CORS_ORIGIN in backend .env includes your Netlify domain
- Browser console should show network requests

### Issue: Pages not loading after redirect
- Check browser console for 404 errors
- Verify all relative paths are correct (no leading `/frontend/`)
- Clear browser cache and hard refresh (Ctrl+Shift+R)

### Issue: Dark theme not persisting
- LocalStorage should work on Netlify
- Check browser DevTools → Application → Local Storage

## Notes
- All API URLs are now centralized in `config.js`
- Paths are relative, so they work on any domain
- Dark mode preference is saved in localStorage
- CORS is properly configured for production
