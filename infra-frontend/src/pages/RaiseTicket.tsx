import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import { Crosshair, Loader2, ImagePlus, X, Send, Map as MapIcon } from 'lucide-react';
import { api } from '../services/api';
import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { toast } from '../store/toastStore';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

function LocationMarker({ position, setPosition }: { position: any, setPosition: any }) {
  useMapEvents({
    click(e) { setPosition(e.latlng); },
  });
  return position === null ? null : <Marker position={position} />;
}

export default function RaiseTicket() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [department, setDepartment] = useState('Civil');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [landmark, setLandmark] = useState('');
  const [campus, setCampus] = useState<'NORTH' | 'SOUTH'>('NORTH');
  const [building, setBuilding] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'URGENT'>('NORMAL');
  const [contactPhone, setContactPhone] = useState('');

  const [coordinates, setCoordinates] = useState<{lat: number, lng: number} | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [isLocating, setIsLocating] = useState(false);

  const campusCenter: [number, number] = [31.7754, 76.9861];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files).slice(0, 5);
      setFiles(selectedFiles);
      setPreviewUrls(selectedFiles.map(file => URL.createObjectURL(file)));
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
    setPreviewUrls(previewUrls.filter((_, i) => i !== index));
  };

  const handleAutoLocation = () => {
    setIsLocating(true);
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCoordinates({ lat: position.coords.latitude, lng: position.coords.longitude });
          setShowMap(false);
          setIsLocating(false);
        },
        (err) => {
          console.error("GPS Error:", err);
          toast.error("Could not get your location. Turn on location services.");
          setIsLocating(false);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      toast.error("Location is not supported by this browser.");
      setIsLocating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title.trim()) return setError('Enter a title.');
    if (!description.trim()) return setError('Enter a description.');
    if (!landmark.trim()) return setError('Enter a landmark.');
    if (!category.trim()) return setError('Enter a category.');
    if (!contactPhone.trim()) return setError('Enter a contact phone number.');
    setIsSubmitting(true);

    const formData = new FormData();
    formData.append('title', title.trim());
    formData.append('department', department);
    formData.append('description', description);
    formData.append('type', 'recurring');
    formData.append('campus', campus);
    formData.append('building', building.trim());
    formData.append('landmark', landmark.trim());
    formData.append('category', category.trim());
    formData.append('priority', priority);
    formData.append('contact_phone', contactPhone.trim());
    if (coordinates) {
      formData.append('lat', String(coordinates.lat));
      formData.append('lng', String(coordinates.lng));
    }
    files.forEach(file => formData.append('files', file));

    try {
      const response = await api.post('/tickets', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (response.data.success) navigate('/');
    } catch (err: any) {
      const validationErrors = err.response?.data?.errors as { path: string; message: string }[] | undefined;
      const message = validationErrors?.length
        ? validationErrors.map((issue) => issue.message).join(' ')
        : err.response?.data?.message || 'Could not submit the ticket. Try again.';
      setError(message);
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    return () => previewUrls.forEach(url => URL.revokeObjectURL(url));
  }, [previewUrls]);

  return (
    <div className="max-w-5xl mx-auto w-full">
      <div className="md:hidden flex items-center justify-center mb-6">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">New Ticket</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 bg-white dark:bg-slate-800 md:p-10 md:rounded-3xl md:shadow-sm md:border border-gray-200/60 dark:border-slate-700">
        
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm border border-red-100 dark:border-red-900/50 font-medium">
            {error}
          </div>
        )}

        {/* 1. Photos */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">Photos</label>
          {previewUrls.length === 0 ? (
            <label className="border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors rounded-2xl p-12 flex flex-col items-center justify-center cursor-pointer group">
              <div className="w-16 h-16 bg-white dark:bg-slate-800 rounded-full shadow-sm flex items-center justify-center mb-4 group-hover:scale-105 transition-transform border dark:border-slate-700">
                <ImagePlus size={28} className="text-slate-400 dark:text-slate-300 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors" />
              </div>
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Add Photos</span>
              <span className="text-xs text-slate-400 dark:text-slate-500 mt-1">Up to 5 images</span>
              <input type="file" multiple accept="image/*" className="hidden" onChange={handleFileChange} />
            </label>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {previewUrls.map((url, index) => (
                <div key={index} className="relative aspect-square rounded-xl overflow-hidden shadow-sm group border border-slate-200 dark:border-slate-700">
                  <img src={url} alt="Preview" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => removeFile(index)} className="absolute top-2 right-2 bg-slate-900/70 text-white p-1.5 rounded-full hover:bg-red-600 transition backdrop-blur-sm">
                    <X size={14} />
                  </button>
                </div>
              ))}
              {previewUrls.length < 5 && (
                <label className="aspect-square rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-center cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-900 transition">
                  <ImagePlus size={24} className="text-slate-400 dark:text-slate-500" />
                  <input type="file" multiple accept="image/*" className="hidden" onChange={handleFileChange} />
                </label>
              )}
            </div>
          )}
        </div>

        {/* 2. Department */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">Department</label>
          <div className="grid grid-cols-3 gap-2 bg-slate-100 dark:bg-slate-900/80 p-1.5 rounded-xl">
            {['Civil', 'Electrical', 'Horticulture'].map(dept => (
              <button
                key={dept} type="button" onClick={() => setDepartment(dept)}
                className={`py-2.5 text-xs md:text-sm font-semibold rounded-lg transition-all ${department === dept ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
              >
                {dept}
              </button>
            ))}
          </div>
        </div>

        {/* 2b. Campus */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">Campus</label>
          <div className="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-slate-900/80 p-1.5 rounded-xl">
            {(['NORTH', 'SOUTH'] as const).map(c => (
              <button
                key={c} type="button" onClick={() => setCampus(c)}
                className={`py-2.5 text-xs md:text-sm font-semibold rounded-lg transition-all ${campus === c ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* 2c. Category & Priority */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">Category</label>
            <input
              type="text"
              required
              placeholder="e.g. plumbing, wiring, road"
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">Priority</label>
            <div className="grid grid-cols-3 gap-2 bg-slate-100 dark:bg-slate-900/80 p-1.5 rounded-xl">
              {(['LOW', 'NORMAL', 'URGENT'] as const).map(p => (
                <button
                  key={p} type="button" onClick={() => setPriority(p)}
                  className={`py-2.5 text-xs font-semibold rounded-lg transition-all ${priority === p ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 2.5 Title */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">Title</label>
          <input 
            type="text" 
            required
            placeholder="Short summary, e.g. Water leak in Lab B2-104"
            className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 font-medium"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* 3. Description */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">Description</label>
          <textarea 
            className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all resize-none bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
            rows={4} placeholder="What is wrong, and where" value={description} onChange={(e) => setDescription(e.target.value)} required
          />
        </div>

        {/* 4. Location */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-3 tracking-wider uppercase">Location</label>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Building (optional)"
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
              value={building}
              onChange={(e) => setBuilding(e.target.value)}
            />
            <div className="flex flex-col md:flex-row gap-3">
              <button type="button" onClick={handleAutoLocation} disabled={isLocating} className="flex-1 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-gray-100 text-white dark:text-slate-900 font-semibold py-3.5 rounded-xl flex items-center justify-center gap-3 transition-colors shadow-sm disabled:opacity-70">
                {isLocating ? <Loader2 className="animate-spin" size={18} /> : <Crosshair size={18} />}
                {isLocating ? 'Acquiring GPS...' : 'Capture Current Location'}
              </button>
              <button type="button" onClick={() => setShowMap(!showMap)} className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <MapIcon size={18} className="text-slate-400 dark:text-slate-400" />
                {showMap ? 'Hide Map' : 'Choose on Campus Map'}
              </button>
            </div>

            {showMap && (
              <div className="h-72 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 relative z-0 shadow-inner">
                <MapContainer center={campusCenter} zoom={16} scrollWheelZoom={true} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <LocationMarker position={coordinates} setPosition={setCoordinates} />
                </MapContainer>
                <div className="absolute top-2 left-2 right-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur text-xs font-semibold py-2 px-3 rounded-lg text-center shadow-sm z-[400] text-slate-700 dark:text-slate-200">
                  Tap anywhere on the map to place a pin
                </div>
              </div>
            )}

            <input 
              type="text" 
              required
              placeholder="Landmark, e.g. near A1 Main Gate *" 
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
            />
            <input
              type="tel"
              required
              placeholder="Contact phone *"
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
        </div>

        {/* 5. Sticky Submit */}
        <div className="fixed bottom-[4.5rem] md:static left-0 right-0 p-4 md:p-0 bg-white/80 dark:bg-slate-900/80 md:bg-transparent backdrop-blur-md md:backdrop-blur-none border-t border-slate-200 dark:border-slate-700 md:border-none z-40 md:pt-4">
          <button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {isSubmitting ? <><Loader2 size={20} className="animate-spin" /> Submitting…</> : <><Send size={20} /> Submit</>}
          </button>
        </div>
      </form>
    </div>
  );
}