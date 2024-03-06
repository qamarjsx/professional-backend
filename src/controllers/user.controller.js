import { asyncHandler } from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import {
  uploadOnCloudinary,
  removeFromCloudinary,
} from "../utils/fileUpload.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";

const extractPubicId = (cloudinaryAssetUrl) => {
  const parts = cloudinaryAssetUrl.split("/");
  return parts[7].split(".")[0];
};

const generateAccessAndRefreshToken = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(401, "Error in generating the tokens!");
  }
};

const registerUser = asyncHandler(async (req, res) => {
  // get user details from frontend
  // validate the entered details, not empty
  // check if the user already exists, email and username
  // check for images, avatar
  // upload them to cloudinary, avatar
  // create user object - create entry in db
  // remove password and refresh token field from response
  // check for user creation
  // return res

  const { fullName, username, email, password } = req.body;
  // console.log(req.body);

  if (!fullName || !email || !password || !username) {
    throw new ApiError(400, "All fields are required!");
  }

  const existedUser = await User.findOne({ $or: [{ username }, { email }] });

  if (existedUser) {
    throw new ApiError(409, "This username or email is already registered.");
  }

  // console.log(req.files.avatar);
  const avatarLocalPath = req.files.avatar[0].path;
  // const coverImageLocalPath = req.files?.coverImage[0]?.path || "";

  let coverImageLocalPath;
  if (
    req.files &&
    Array.isArray(req.files.coverImage) &&
    req.files.coverImage.length > 0
  ) {
    coverImageLocalPath = req.files.coverImage[0].path;
  }

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar is required.");
  }

  // console.log(req.files);

  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  if (!avatar) {
    throw new ApiError(400, "Avatar is required.");
  }

  // console.log(avatar); An object is being returned by cloudinary

  const user = await User.create({
    fullName,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    email,
    password,
    username: username.toLowerCase(),
  });

  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  // console.log(user); had password
  // console.log(createdUser); diselected it

  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering the user!");
  }

  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, "User registed successfully!"));
});

const loginUser = asyncHandler(async (req, res) => {
  // get username or email and password
  // check if this email and password matches in the database
  // if it does, generate access token and refresh token, send in cookies and the user logs in
  // if it does not, send response that the username or password is incorrect

  const { username, email, password } = req.body;

  // console.log(req.body);

  if (!username && !email) {
    throw new ApiError(400, "Username or email is required.");
  }

  if (!password) {
    throw new ApiError(400, "Password is required.");
  }

  const user = await User.findOne({ $or: [{ username }, { email }] });

  if (!user) {
    throw new ApiError(404, "User does not exist!");
  }

  const isPasswordValid = await user.isPasswordCorrect(password);

  // console.log(isPasswordValid);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials!");
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
    user._id
  );

  const loggedInuser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  // cookies options
  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        { user: loggedInuser, accessToken, refreshToken },
        "User logged in successfully!"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  // clear the cookies
  // refresh token reset

  // tried this: console.log(req.session);

  const user = req.user;

  await User.findByIdAndUpdate(
    user._id,
    { $set: { refreshToken: undefined } },
    { new: true }
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, "User logged out successfully!"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  // console.log(req.cookies.refreshToken);
  // console.log(req.headers);
  // console.log(req.body.refreshToken);
  // console.log(req.header("Connection"));

  const incomingRefreshToken =
    req.cookies?.refreshToken || req.body.refreshToken;

  console.log(incomingRefreshToken);

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Did not get the refresh token");
  }

  const decodedToken = jwt.verify(
    incomingRefreshToken,
    process.env.REFRESH_TOKEN_SECRET
  );

  const user = await User.findById(decodedToken._id);

  if (!user) {
    throw new ApiError(401, "Did not found the user");
  }

  if (incomingRefreshToken !== user.refreshToken) {
    throw new ApiError(401, "Refresh tokens do not match.");
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
    user._id
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(new ApiResponse(200, "Access token refreshed."));
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    throw new ApiError(400, "All fields are required!");
  }

  console.log(req.user._id);

  const user = await User.findById(req.user._id);

  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

  if (!isPasswordCorrect) {
    throw new ApiError(400, "Old password is wrong!");
  }

  user.password = newPassword;

  await user.save({ validateBeforeSave: false });

  res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully!"));
});

const updateUserDetails = asyncHandler(async (req, res) => {
  const { username, fullName } = req.body;

  if (!username && !fullName) {
    throw new ApiError(
      400,
      "Any one field is required if you are going to update it."
    );
  }
  console.log(req.user);
  const user = await User.findById(req.user._id);

  if (username) {
    user.username = username.toLowerCase();
  }

  if (fullName) {
    user.fullName = fullName;
  }

  await user.save({ validateBeforeSave: false });

  res
    .status(200)
    .json(new ApiResponse(200, user, "User details updated successfully!"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
  console.log(req.user);
  return res
    .status(200)
    .json(200, req.user, "Current user fetched successfully!");
});

const updateAvatar = asyncHandler(async (req, res) => {
  const newAvatarLocalPath = req.file.path;

  if (!newAvatarLocalPath) {
    throw new ApiError(400, "Avatar is required.");
  }

  // console.log(req.user._id);

  const user = await User.findById(req.user._id).select("-password");

  if (!user) {
    throw new ApiError(404, "User does not exist!");
  }

  const oldAvatarPublicId = extractPubicId(user.avatar);

  console.log(oldAvatarPublicId);

  if (oldAvatarPublicId) {
    await removeFromCloudinary(oldAvatarPublicId);
  }

  const avatar = await uploadOnCloudinary(newAvatarLocalPath);

  if (!avatar) {
    throw new ApiError(400, "Avatar is required.");
  }

  user.avatar = avatar.url;
  await user.save({ validateBeforeSave: false });

  res
    .status(200)
    .json(new ApiResponse(200, user, "Avatar image updatedsuccessfully."));
});

export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateUserDetails,
  updateAvatar,
};
