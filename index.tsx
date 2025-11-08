import { render } from "preact";
import { useState, useEffect } from "preact/hooks";
import { html } from "htm/preact";
import { GoogleGenAI, Type } from "@google/genai";

// --- MOCK DATABASE & AUTH ---
// In a real app, this would be a backend service.
const usePersistentState = (key, defaultValue) => {
  const [state, setState] = useState(() => {
    const storedValue = localStorage.getItem(key);
    return storedValue ? JSON.parse(storedValue) : defaultValue;
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);
  return [state, setState];
};

const ROLES = {
  CITIZEN: "citizen",
  ADMIN: "admin",
};

const STATUSES = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
};

const CATEGORIES = ["Roads", "Drainage", "Street Lighting", "Sanitation", "Water Supply", "Other"];

// --- COMPONENTS ---

function GrievanceForm({ onSubmit, loading }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [image, setImage] = useState(null);
  const [location, setLocation] = useState(null);
  const [error, setError] = useState("");

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImage({ file: file, name: file.name });
    }
  };

  const handleGetLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setLocation({ lat: latitude, lon: longitude });
          setError("");
        },
        () => {
          setError("Unable to retrieve your location. Please check your browser permissions.");
        }
      );
    } else {
      setError("Geolocation is not supported by your browser.");
    }
  };

  const handleSubmit = (e) => {
      e.preventDefault();
      if (!description) {
          setError("Please enter a description for your grievance.");
          return;
      }
      setError("");
      onSubmit({ category, description, image, location });
  }

  return html`
    <form class="container" onSubmit=${handleSubmit}>
        ${error && html`<div class="error" role="alert" style="margin-bottom: 1rem;">${error}</div>`}
        <div class="form-group">
            <label for="category">Grievance Category</label>
            <select id="category" class="input-base" value=${category} onChange=${(e) => setCategory(e.currentTarget.value)} disabled=${loading}>
                ${CATEGORIES.map(cat => html`<option value=${cat}>${cat}</option>`)}
            </select>
        </div>
        <div class="form-group">
            <label for="description">Detailed Description</label>
            <textarea id="description" class="input-base" value=${description} onInput=${(e) => setDescription(e.currentTarget.value)} placeholder="Describe the problem in detail..." aria-label="Grievance Description" disabled=${loading}></textarea>
        </div>
        <div class="form-group">
            <label>Photo Evidence (Optional)</label>
            <div>
                <label for="file-upload" class="file-input-label">Choose File</label>
                <input id="file-upload" type="file" onChange=${handleImageChange} accept="image/*" disabled=${loading} />
                ${image && html`<span class="file-name">${image.name}</span>`}
            </div>
        </div>
        <div class="form-group">
            <label>Location (Optional)</label>
            <div class="location-group">
                <button type="button" onClick=${handleGetLocation} disabled=${loading}>Get My Location</button>
                ${location && html`<div class="location-display">Lat: ${location.lat.toFixed(4)}, Lon: ${location.lon.toFixed(4)}</div>`}
            </div>
        </div>
        <button type="submit" disabled=${loading} class="submit-button" style="align-self: flex-end;">
            ${loading ? "Submitting..." : "Submit Grievance"}
        </button>
    </form>
  `;
}

function AuthPage({ view, setView, handleAuth }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(ROLES.CITIZEN);
  const [error, setError] = useState("");

  const isLogin = view === 'login';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    const success = handleAuth({ email, password, role });
    if (!success) {
      setError(isLogin ? "Invalid credentials." : "User already exists.");
    } else {
      setError("");
    }
  };

  return html`
    <div class="auth-container">
      <form class="auth-form" onSubmit=${handleSubmit}>
        <h1>${isLogin ? 'Login' : 'Sign Up'}</h1>
        ${error && html`<div class="error" role="alert">${error}</div>`}
        <div class="form-group">
          <label for="email">Email</label>
          <input id="email" type="email" class="input-base" value=${email} onInput=${(e) => setEmail(e.currentTarget.value)} required />
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input id="password" type="password" class="input-base" value=${password} onInput=${(e) => setPassword(e.currentTarget.value)} required />
        </div>
        ${!isLogin && html`
          <div class="form-group">
            <label for="role">I am a...</label>
            <select id="role" class="input-base" value=${role} onChange=${(e) => setRole(e.currentTarget.value)}>
              <option value=${ROLES.CITIZEN}>Citizen</option>
              <option value=${ROLES.ADMIN}>Admin</option>
            </select>
          </div>
        `}
        <button type="submit" class="submit-button">${isLogin ? 'Login' : 'Create Account'}</button>
        <div class="auth-switch">
          ${isLogin ? "Don't have an account?" : "Already have an account?"}
          <button type="button" onClick=${() => setView(isLogin ? 'signup' : 'login')}>
            ${isLogin ? 'Sign Up' : 'Login'}
          </button>
        </div>
      </form>
    </div>
  `;
}

function CitizenDashboard({ user, addGrievance }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  
  // FIX: Resolve error from reader.result potentially not being a string, and add error handling.
  const fileToGenerativePart = async (file) => {
    const base64EncodedDataPromise = new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result.split(',')[1]);
        } else {
          reject(new Error("Failed to read file as base64 string."));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return {
      inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
  }

  const submitGrievance = async (formData) => {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const textParts = [`Category: ${formData.category}`, `Description: ${formData.description}`];
      if (formData.location) {
        textParts.push(`Location: Latitude ${formData.location.lat}, Longitude ${formData.location.lon}`);
      }
      
      // FIX: Explicitly type promptParts to allow both text and image parts, fixing a TypeScript error
      // when trying to push an image part into an array inferred as text parts only.
      const promptParts: ({ text: string } | { inlineData: { data: string; mimeType: string; } })[] = [{ text: textParts.join('\n') }];

      if (formData.image) {
        const imagePart = await fileToGenerativePart(formData.image.file);
        promptParts.push(imagePart);
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: promptParts },
        config: {
            systemInstruction: "You are an AI assistant for a public grievance system. Analyze the citizen's complaint (including any images). Provide a summary, assign it to a relevant department, and generate a unique tracking ID. Respond in JSON format.",
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    trackingId: { type: Type.STRING, description: "A unique alphanumeric tracking ID, e.g., GRV-12345" },
                    summary: { type: Type.STRING, description: "A brief summary of the grievance." },
                    assignedDepartment: { type: Type.STRING, description: "The local government department responsible for this issue (e.g., Public Works, Sanitation Dept)." },
                    nextSteps: { type: Type.STRING, description: "A short message to the citizen about what happens next." }
                },
                required: ["trackingId", "summary", "assignedDepartment", "nextSteps"]
            }
        }
      });
      
      const jsonResponse = JSON.parse(response.text);
      setResult(jsonResponse);
      addGrievance({ ...formData, ...jsonResponse, submittedBy: user.email, status: STATUSES.PENDING, id: jsonResponse.trackingId, timestamp: new Date().toISOString() });
    } catch (err) {
      console.error("Error submitting grievance:", err);
      setError("Failed to submit grievance. The AI model may be busy. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  return html`
    <header>
      <h1>Submit a Grievance</h1>
      <p>Report local issues and help improve your community.</p>
    </header>
    <${GrievanceForm} onSubmit=${submitGrievance} loading=${loading} />
    ${loading && html`<div class="loading" aria-busy="true">Analyzing and submitting your report...</div>`}
    ${error && html`<div class="error" role="alert">${error}</div>`}
    ${result && html`
        <div class="result">
            <h2>Grievance Submitted Successfully</h2>
            <p><strong>Tracking ID:</strong> ${result.trackingId}</p>
            <p><strong>Assigned Department:</strong> ${result.assignedDepartment}</p>
            <p><strong>Summary:</strong> ${result.summary}</p>
            <p><strong>Next Steps:</strong> ${result.nextSteps}</p>
            <p>You can track the status of this grievance in the "My Grievances" section below.</p>
        </div>
    `}
  `;
}

function GrievanceList({ grievances, title, isAdmin, updateStatus }) {
  if (grievances.length === 0) {
    return html`<div class="container"><p>No grievances to display.</p></div>`;
  }
  
  return html`
    <div class="dashboard-section">
      <h2>${title}</h2>
      <div class="container" style="padding: 0;">
        <table class="grievance-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Category</th>
              ${isAdmin && html`<th>Submitted By</th>`}
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${grievances.map(g => html`
              <tr key=${g.id}>
                <td data-label="ID">${g.id}</td>
                <td data-label="Category">${g.category}</td>
                ${isAdmin && html`<td data-label="Submitted By">${g.submittedBy}</td>`}
                <td data-label="Status">
                  <span class="status-badge status-${g.status.replace(' ', '')}">${g.status}</span>
                </td>
                <td data-label="Action">
                  ${isAdmin ? html`
                    <select class="input-base" value=${g.status} onChange=${(e) => updateStatus(g.id, e.currentTarget.value)}>
                      ${Object.values(STATUSES).map(s => html`<option value=${s}>${s}</option>`)}
                    </select>
                  ` : 'No actions'}
                </td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}


function App() {
  const [view, setView] = usePersistentState('view', 'login');
  const [loggedInUser, setLoggedInUser] = usePersistentState('loggedInUser', null);
  const [users, setUsers] = usePersistentState('users', []);
  const [grievances, setGrievances] = usePersistentState('grievances', []);

  // Ensure admin user exists for demo
  useEffect(() => {
    const adminExists = users.some(u => u.email === 'admin@gov.in');
    if (!adminExists) {
        setUsers(prevUsers => [...prevUsers, { email: 'admin@gov.in', password: 'admin', role: ROLES.ADMIN }]);
    }
  }, [users]);
  
  const handleSignup = ({ email, password, role }) => {
    if (users.find(u => u.email === email)) {
      return false; // User exists
    }
    const newUser = { email, password, role };
    setUsers([...users, newUser]);
    setLoggedInUser(newUser);
    setView(newUser.role === ROLES.ADMIN ? 'adminDashboard' : 'citizenDashboard');
    return true;
  };

  const handleLogin = ({ email, password }) => {
    const user = users.find(u => u.email === email && u.password === password);
    if (user) {
      setLoggedInUser(user);
      setView(user.role === ROLES.ADMIN ? 'adminDashboard' : 'citizenDashboard');
      return true;
    }
    return false;
  };
  
  const handleLogout = () => {
    setLoggedInUser(null);
    setView('login');
  }

  const addGrievance = (grievance) => {
    setGrievances(prev => [grievance, ...prev]);
  };

  const updateGrievanceStatus = (id, newStatus) => {
    setGrievances(prev => prev.map(g => g.id === id ? { ...g, status: newStatus } : g));
  }

  const renderContent = () => {
    if (!loggedInUser || view === 'login' || view === 'signup') {
        return html`<${AuthPage} view=${view} setView=${setView} handleAuth=${view === 'login' ? handleLogin : handleSignup} />`;
    }
    
    const userGrievances = grievances.filter(g => g.submittedBy === loggedInUser.email);

    if (loggedInUser.role === ROLES.CITIZEN) {
      return html`
        <${CitizenDashboard} user=${loggedInUser} addGrievance=${addGrievance} />
        <${GrievanceList} grievances=${userGrievances} title="My Grievances" isAdmin=${false} />
      `;
    }

    if (loggedInUser.role === ROLES.ADMIN) {
      return html`
        <h1>Admin Dashboard</h1>
        <${GrievanceList} grievances=${grievances} title="All Submitted Grievances" isAdmin=${true} updateStatus=${updateGrievanceStatus} />
      `;
    }
  };
  
  return html`
    ${loggedInUser && html`
        <div class="app-header">
            <div class="user-info">Logged in as: <span>${loggedInUser.email}</span></div>
            <button class="logout-button" onClick=${handleLogout}>Logout</button>
        </div>
    `}
    ${renderContent()}
  `;
}

render(html`<${App} />`, document.getElementById("root"));