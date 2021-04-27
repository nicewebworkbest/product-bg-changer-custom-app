//require('isomorphic-fetch');
const Shopify = require('shopify-api-node');

const removeProductImage = async (ctx, productId, imgId) => {
	const { shop, accessToken } = ctx.session;

	const shopify = new Shopify({
		shopName: shop,
		accessToken : accessToken
	});

	shopify.productImage.delete(productId, imgId);
	console.log(imgId + " Image deleted");
};

module.exports = removeProductImage;
