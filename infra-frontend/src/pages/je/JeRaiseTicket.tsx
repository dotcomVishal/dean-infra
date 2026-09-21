import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import {
  Crosshair, Loader2, ImagePlus, X, Send,
  Map as MapIcon, ArrowLeft
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

function LocationMarker({ position, setPosition }: { position: any; setPosition: any }) {
  useMapEvents({
    click(e) {
      setPosition(e.latlng);
    },
  });
  return position === null ? null : <Marker position={position} />;
}

export default function JeRaiseTicket() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [department, setDepartment] = useState(user?.department || 'Civil');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [landmark, setLandmark] = useState('');

  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [isLocating, setIsLocating] = useState(false);

  const campusCenter: [number, number] = [31.7754, 76.9861];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files).slice(0, 5);
      setFiles(selectedFiles);
      setPreviewUrls(selectedFiles.map((file) => URL.createObjectURL(file)));
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
    setPreviewUrls(previewUrls.filter((_, i) => i !== index));
  };

  const handleAutoLocation = () => {
    setIsLocating(true);
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCoordinates({ lat: position.coords.latitude, lng: position.coords.longitude });
          setShowMap(false);
          setIsLocating(false);
        },
        (err) => {
          console.error('GPS Error:', err);
          alert('Could not fetch location. Ensure location services are enabled.');
          setIsLocating(false);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      alert('Geolocation is not supported by your browser');
      setIsLocating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      return setError('Please provide a descriptive title for the proposal.');
    }
    if (!description.trim()) {
      return setError('Please provide the scope of the non-recurring work.');
    }
    if (!landmark.trim()) {
      return setError('Please specify a landmark or precise campus location.');
    }

    setIsSubmitting(true);

    const locationString = coordinates
      ? `Lat: ${coordinates.lat.toFixed(5)}, Lng: ${coordinates.lng.toFixed(5)} | Landmark: ${landmark.trim()}`
      : `Landmark: ${landmark.trim()}`;

    const formData = new FormData();
    formData.append('title', title.trim());
    formData.append('department', department);
    formData.append('description', description.trim());
    formData.append('location', locationString);
    formData.append('type', 'non-recurring'); // Enforced strictly for JE non-recurring proposal

    files.forEach((file) => formData.append('files', file));

    try {
      const response = await api.post('/tickets', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (response.data.success) {
        navigate('/je/dashboard');
      }
    } catch (err: any) {
      console.error('Submission error:', err);
      setError(err.response?.data?.message || 'Failed to submit the non-recurring proposal.');
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    return () => previewUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [previewUrls]);

  return (
    <div className="max-w-4xl mx-auto w-full space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-600 dark:text-slate-300"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
            Non-Recurring Work Proposal
          </h1>
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
            Initiate major infrastructure maintenance, renovation, or capital work proposals
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 bg-white dark:bg-slate-800 p-6 md:p-8 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm"
      >
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm border border-red-100 dark:border-red-900/50 font-medium">
            {error}
          </div>
        )}

        {/* 1. Department */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">
            Department
          </label>
          <div className="grid grid-cols-3 gap-2 bg-slate-100 dark:bg-slate-900/80 p-1.5 rounded-xl">
            {['Civil', 'Electrical', 'Horticulture'].map((dept) => (
              <button
                key={dept}
                type="button"
                onClick={() => setDepartment(dept)}
                className={`py-2.5 text-xs md:text-sm font-semibold rounded-lg transition-all ${
                  department === dept
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {dept}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Proposal Title */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">
            Proposal Title
          </label>
          <input
            type="text"
            required
            placeholder="e.g., Replacement of Main Substation Circuit Breakers"
            className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 font-medium"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* 3. Scope of Work */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">
            Scope & Technical Justification
          </label>
          <textarea
            className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all resize-none bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
            rows={5}
            placeholder="Detailed engineering scope of proposed work, technical justification, estimated material specs..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </div>

        {/* 4. Evidence Photos / Sketches */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 tracking-wider uppercase">
            Preliminary Sketches / Existing Site Photos (Optional)
          </label>
          {previewUrls.length === 0 ? (
            <label className="border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer group">
              <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-full shadow-sm flex items-center justify-center mb-3 group-hover:scale-105 transition-transform border dark:border-slate-700">
                <ImagePlus size={22} className="text-slate-400 dark:text-slate-300 group-hover:text-blue-500 transition-colors" />
              </div>
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Select Photos or Documents
              </span>
              <span className="text-xs text-slate-400 mt-1">
                Up to 5 files (images, PDF)
              </span>
              <input type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
            </label>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {previewUrls.map((url, index) => (
                <div
                  key={index}
                  className="relative aspect-square rounded-xl overflow-hidden shadow-sm group border border-slate-200 dark:border-slate-700"
                >
                  <img src={url} alt="Preview" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="absolute top-1.5 right-1.5 bg-slate-900/70 text-white p-1 rounded-full hover:bg-red-600 transition"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {previewUrls.length < 5 && (
                <label className="aspect-square rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-center cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-900 transition">
                  <ImagePlus size={20} className="text-slate-400 dark:text-slate-500" />
                  <input type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
                </label>
              )}
            </div>
          )}
        </div>

        {/* 5. Location */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-3 tracking-wider uppercase">
            Location & Landmark
          </label>
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={handleAutoLocation}
                disabled={isLocating}
                className="flex-1 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-100 text-white dark:text-slate-900 font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-sm disabled:opacity-70 text-xs md:text-sm"
              >
                {isLocating ? <Loader2 className="animate-spin" size={16} /> : <Crosshair size={16} />}
                {isLocating ? 'Acquiring GPS...' : 'Capture Field GPS'}
              </button>
              <button
                type="button"
                onClick={() => setShowMap(!showMap)}
                className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-xs md:text-sm"
              >
                <MapIcon size={16} className="text-slate-400" />
                {showMap ? 'Hide Campus Map' : 'Select on Campus Map'}
              </button>
            </div>

            {showMap && (
              <div className="h-64 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 relative z-0 shadow-inner">
                <MapContainer center={campusCenter} zoom={16} scrollWheelZoom={true} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <LocationMarker position={coordinates} setPosition={setCoordinates} />
                </MapContainer>
              </div>
            )}

            <input
              type="text"
              required
              placeholder="Exact building, wing, room number, or outdoor landmark"
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 font-medium"
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
            />
          </div>
        </div>

        {/* Submit */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl shadow-sm transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-sm"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Submitting Non-Recurring Proposal...
              </>
            ) : (
              <>
                <Send size={16} />
                Submit Non-Recurring Work Proposal
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
